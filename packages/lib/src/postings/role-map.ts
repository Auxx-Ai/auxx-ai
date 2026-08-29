// packages/lib/src/postings/role-map.ts

/**
 * The role map, read and written: which of the org's OWN accounts fulfils each
 * auxx posting role (decision `G19`), plus the chart those accounts come from.
 *
 * `resolve-roles.ts` is the READ that a posting makes - one batch, fail closed,
 * no partial answers. This file is the read a PERSON makes, and the write that
 * fixes what they find. Before it, `GlRoleAssignment` could be resolved and
 * seeded and nothing else: nothing could list an assignment, nothing could
 * change one, and nothing could see the chart through this surface at all. A
 * bookkeeper whose `grni` pointed at the wrong account had no door.
 *
 * ## The list is a CHECKLIST, not a table dump
 *
 * {@link listRoleMap} returns one row for EVERY role in `ACCOUNT_ROLES`, mapped
 * or not. That is the whole difference between this and `select * from
 * GlRoleAssignment`: a screen that rendered only the rows that happen to exist
 * could never show what is MISSING, and "which roles has nobody mapped yet" is
 * the single question the `G19` setup wizard exists to answer. An absent row is
 * information, so it gets a row.
 *
 * ## The write validates against the same two facts the resolver does
 *
 * {@link setRoleAssignment} refuses, BEFORE writing, a role outside
 * `ACCOUNT_ROLES` and an account whose `accountType` is incompatible with the
 * role - the same `ROLE_ACCOUNT_TYPES` table `resolveRoles` checks on the read
 * side, because a mapping that only fails at a close fails on the night of the
 * close. Pointing `grni` at a revenue account produces an entry that BALANCES,
 * so nothing downstream can detect it; catching it here is the difference
 * between a validation message and a restatement.
 *
 * ⚠️ **No caching, deliberately.** `resolve-roles.ts` carries the long argument:
 * the invalidation graph has no per-record event for a `gl_account` rename or
 * archive, so a cached key is correct for an hour and then fails OPEN - the
 * entry still balances. This file reads the same rows through the same door and
 * inherits the same rule. Do not add an `OrgCacheDataMap` key to either until
 * `gl_account` create/update/archive have events of their own.
 *
 * No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, BadRequestError, NotFoundError, UnprocessableEntityError } from '../errors'
import { ACCOUNT_ROLES, type AccountRole, ROLE_ACCOUNT_TYPES } from './build-entry'
import {
  type ChartAccountsRead,
  loadChartAccountFields,
  loadChartAccountsById as readChartAccountsById,
  readChartAccountValues,
} from './chart-accounts'
import type { ChartAccountRow, RoleAssignmentRow, RoleAssignmentState } from './types'

const logger = createScopedLogger('postings:role-map')

/**
 * What an unprovisioned chart refuses a role-map READER with.
 *
 * `resolve-roles.ts` checks the same fact through the same shared door and says
 * something else, deliberately: that sentence is read by whoever is trying to
 * post, this one by whoever is setting the chart up. The check is shared in
 * `chart-accounts.ts`; the advice is not.
 */
const NOT_PROVISIONED =
  'The chart of accounts is not provisioned for this organization - gl_account_code / gl_account_type are missing. Run the entity migrations.'

/** Every declared role, in declaration order. The checklist `listRoleMap` walks. */
const ALL_ROLES: readonly AccountRole[] = Object.values(ACCOUNT_ROLES)

/** Is `role` one of the thirteen declared roles? The vocabulary is CLOSED. */
function isAccountRole(role: string): role is AccountRole {
  return (ALL_ROLES as readonly string[]).includes(role)
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every posting role with its assignment, its account, and its derived state.
 *
 * Returns exactly `ACCOUNT_ROLES.length` rows, always, in declaration order -
 * see the file header on why an unmapped role still gets a row.
 *
 * `state` is DERIVED here rather than stored, collapsing three columns into the
 * one answer a screen renders, in this precedence:
 *
 * | Condition | State | What the reader is being told |
 * | --- | --- | --- |
 * | no `GlRoleAssignment` row | `unmapped` | nobody has looked at this yet |
 * | `markedUnused` | `unused` | somebody said "we do not use this" |
 * | `confirmedAt` set | `confirmed` | a person chose this account |
 * | otherwise | `suggested` | the seed chose it and nobody has agreed yet |
 *
 * `markedUnused` outranks `confirmedAt` on purpose: a row can carry both once
 * somebody confirms a mapping and later marks the role unused, and "we do not
 * use this" is the more recent and the more consequential of the two claims.
 *
 * `account` is null for an `unmapped` or `unused` role, and also for a mapping
 * whose account has been deleted or archived out from under it - the dangling
 * case `GlRoleAssignment` deliberately has no foreign key to prevent. A screen
 * seeing `state: 'confirmed'` with `account: null` is looking at exactly that,
 * and it is the repair `resolveRoles` would otherwise refuse a close over.
 *
 * Two queries: the assignments, then the accounts they name. Never N+1.
 */
export async function listRoleMap(
  db: Database,
  organizationId: string
): Promise<Result<RoleAssignmentRow[], Error>> {
  try {
    const assignments = await db
      .select({
        role: schema.GlRoleAssignment.role,
        glAccountId: schema.GlRoleAssignment.glAccountId,
        source: schema.GlRoleAssignment.source,
        confirmedAt: schema.GlRoleAssignment.confirmedAt,
        markedUnused: schema.GlRoleAssignment.markedUnused,
      })
      .from(schema.GlRoleAssignment)
      .where(eq(schema.GlRoleAssignment.organizationId, organizationId))

    const byRole = new Map(assignments.map((row) => [row.role, row]))

    // Only the accounts a mapping actually names. An org with no assignments
    // reads no chart at all, which is what keeps a fresh org's role map a list
    // of thirteen `unmapped` rows rather than a provisioning error.
    const accountIds = [...new Set(assignments.map((row) => row.glAccountId))]
    const accounts = await loadChartAccountsById(db, organizationId, accountIds)

    const rows: RoleAssignmentRow[] = ALL_ROLES.map((role) => {
      const assignment = byRole.get(role)
      if (!assignment) {
        return {
          role,
          state: 'unmapped',
          accountId: null,
          account: null,
          source: null,
          confirmedAt: null,
        }
      }

      const state: RoleAssignmentState = assignment.markedUnused
        ? 'unused'
        : assignment.confirmedAt
          ? 'confirmed'
          : 'suggested'

      // `accountId` is null while unmapped or unused, per `RoleAssignmentRow`.
      // The column is NOT NULL so an unused row still holds an id in Postgres;
      // surfacing it would invite a screen to render "unused, mapped to 2160",
      // which is two contradictory claims about the same role.
      if (state === 'unused') {
        return {
          role,
          state,
          accountId: null,
          account: null,
          source: assignment.source,
          confirmedAt: toIso(assignment.confirmedAt),
        }
      }

      return {
        role,
        state,
        accountId: assignment.glAccountId,
        account: accounts.get(assignment.glAccountId) ?? null,
        source: assignment.source,
        confirmedAt: toIso(assignment.confirmedAt),
      }
    })

    return ok(rows)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to list the role map', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * The org's editable chart of accounts - every live `gl_account` instance.
 *
 * Archived instances are excluded by the query, exactly as `resolveRoles` does:
 * from a mapping's point of view "archived" and "deleted" are the same fact, and
 * an account somebody archived must not reappear in the picker that assigns
 * roles.
 *
 * An account missing `gl_account_code` or `gl_account_type` is SKIPPED and
 * logged rather than defaulted. Guessing a type would defeat the compatibility
 * check that is the only reason the type is read, and a blank code on a ledger
 * line is unauditable (decision `P2`). The log line names the ids so a malformed
 * account is findable rather than merely invisible.
 *
 * Ordered by `code`, which is the order a chart of accounts is read in
 * everywhere else in the world.
 */
export async function listChartAccounts(
  db: Database,
  organizationId: string
): Promise<Result<ChartAccountRow[], Error>> {
  try {
    const fields = await loadChartAccountFields(organizationId, NOT_PROVISIONED)

    // The `gl_account` definition, taken from the field that belongs to it.
    // Cheaper and less fragile than a second cache key: `gl_account_code` exists
    // if and only if the def does, and it is already loaded.
    const glAccountDefId = fields.code.entityDefinitionId
    if (!glAccountDefId) {
      throw new UnprocessableEntityError(
        'The chart of accounts is not provisioned for this organization - gl_account_code is not attached to an entity definition. Run the entity migrations.',
        { organizationId }
      )
    }

    const instances = await db
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, glAccountDefId),
          isNull(schema.EntityInstance.archivedAt)
        )
      )

    const accounts = warnMalformed(
      organizationId,
      await readChartAccountValues(
        db,
        organizationId,
        instances.map((row) => row.id),
        fields
      )
    )

    return ok([...accounts.values()].sort((a, b) => a.code.localeCompare(b.code)))
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to list the chart of accounts', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * How many posted lines name each account CODE.
 *
 * The one number the chart's renumber warning needs. A posting line stores the
 * account code with **no foreign key** (`P2`), deliberately, so the ledger
 * outlives the chart - which means renumbering an account leaves every line
 * already posted holding the old code. That is a feature, and it is also the
 * kind of feature a person should be told about with a NUMBER rather than a
 * caution: "142 posted lines carry 1310" is what makes the trade concrete.
 *
 * ⚠️ **Keyed on CODE, not on account id**, because a code is what a posted line
 * actually stores. Two consequences, both correct: an account never posted to
 * reports nothing, and an account whose code was PREVIOUSLY carried by a
 * different account reports that history too. The question the number answers is
 * "how many posted lines say `1310`", which is exactly the question somebody
 * about to renumber is asking.
 *
 * 🛑 Deliberately NOT folded into {@link listChartAccounts}. `ChartAccountRow` is
 * shared with `resolveRoles`' path and decoded by every reader of this chart; a
 * field only the settings screen renders does not belong on it.
 */
export async function listChartAccountUsage(
  db: Database,
  organizationId: string
): Promise<Result<Record<string, number>, Error>> {
  try {
    const rows = await db
      .select({
        accountCode: schema.GlPostingLine.accountCode,
        lines: count(),
      })
      .from(schema.GlPostingLine)
      .where(eq(schema.GlPostingLine.organizationId, organizationId))
      .groupBy(schema.GlPostingLine.accountCode)

    const usage: Record<string, number> = {}
    for (const row of rows) {
      if (row.accountCode) usage[row.accountCode] = Number(row.lines) || 0
    }
    return ok(usage)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to count posted lines per account', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/** What one role-map edit is asking for. Exactly one of the three modes below. */
export interface SetRoleAssignmentOptions {
  organizationId: string
  /** An `ACCOUNT_ROLES` value. Anything else is a `BadRequestError`. */
  role: string
  /** The `gl_account` instance to point the role at. Validated before writing. */
  glAccountId?: string | null
  /** `true` marks the role unused; `false` clears that mark. */
  markedUnused?: boolean
  /** Who is doing this. Stamped as `confirmedByUserId` when a mapping is set. */
  actorUserId?: string
}

/**
 * Point one role at one account, or mark it unused - upserting the single row
 * the `(organizationId, role)` unique index permits.
 *
 * Three modes, and the arguments pick exactly one:
 *
 * | Call | Effect |
 * | --- | --- |
 * | `{ role, glAccountId }` | map it: `source: 'human'`, `confirmedAt: now`, `confirmedByUserId`, `markedUnused: false` |
 * | `{ role, markedUnused: true }` | mark it unused, keeping the account it already names |
 * | `{ role, markedUnused: false }` | clear the unused mark, restoring whatever it was before |
 *
 * `glAccountId` together with `markedUnused: true` is a contradiction - "use
 * this account" and "we do not use this role" - and is refused rather than
 * silently resolved in one direction.
 *
 * ## What is validated before anything is written
 *
 * - the role is in `ACCOUNT_ROLES` (`BadRequestError`). The vocabulary is CLOSED:
 *   an org may renumber, rename or replace the ACCOUNT behind a role, it may not
 *   invent a role, because a role only means something if a builder emits it.
 * - the account exists in THIS org and is not archived (`UnprocessableEntityError`)
 * - the account is active (`UnprocessableEntityError`)
 * - the account's `accountType` matches `ROLE_ACCOUNT_TYPES[role]`
 *   (`UnprocessableEntityError`, naming the role, the account and both types)
 *
 * The last one is the one that matters. `resolveRoles` performs the identical
 * check at post time off the identical table, and if this write did not, the
 * first anyone would learn of the mismatch is a refused close. An entry posted
 * to the wrong KIND of account still balances, so there is no downstream reader
 * that could catch it.
 *
 * 🛑 `source: 'human'` and a `confirmedAt` stamp are written only in the mapping
 * mode. Marking a role unused is not a confirmation of the account behind it,
 * and stamping one would erase the `G19` distinction the wizard renders -
 * "we chose this for you" versus "you chose this".
 *
 * @returns the role's row as {@link listRoleMap} would render it afterwards.
 */
export async function setRoleAssignment(
  db: Database,
  options: SetRoleAssignmentOptions
): Promise<Result<RoleAssignmentRow, Error>> {
  const { organizationId, role, actorUserId } = options
  const glAccountId = options.glAccountId?.trim() || null
  const markedUnused = options.markedUnused

  try {
    if (!isAccountRole(role)) {
      throw new BadRequestError(
        `'${role}' is not a declared posting role. The role vocabulary is closed - see ACCOUNT_ROLES.`,
        { organizationId, role }
      )
    }

    if (glAccountId && markedUnused === true) {
      throw new BadRequestError(
        `Cannot both map '${role}' to an account and mark it unused. Send one or the other.`,
        { organizationId, role }
      )
    }

    if (glAccountId) {
      return ok(await mapRole(db, organizationId, role, glAccountId, actorUserId))
    }

    if (markedUnused !== undefined) {
      return ok(await setUnusedFlag(db, organizationId, role, markedUnused))
    }

    throw new BadRequestError(
      `Nothing to set for '${role}'. Send an account to map it to, or markedUnused.`,
      { organizationId, role }
    )
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to set a role assignment', { error, organizationId, role })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * Validate, then upsert the mapping mode.
 *
 * `onConflictDoUpdate` on `(organizationId, role)` rather than a read-then-write:
 * that index is what makes the resolver's answer unambiguous, and it is the same
 * index that makes this write safe against a concurrent editor. A check-then-
 * insert would let two admins create two rows for one role, which is the ONE
 * state `resolveRoles` refuses outright rather than choosing between.
 */
async function mapRole(
  db: Database,
  organizationId: string,
  role: AccountRole,
  glAccountId: string,
  actorUserId: string | undefined
): Promise<RoleAssignmentRow> {
  const accounts = await loadChartAccountsById(db, organizationId, [glAccountId])
  const account = accounts.get(glAccountId)

  if (!account) {
    throw new UnprocessableEntityError(
      `Cannot map '${role}': account ${glAccountId} does not exist in this organization, or has been archived.`,
      { organizationId, role, glAccountId }
    )
  }

  if (!account.isActive) {
    throw new UnprocessableEntityError(
      `Cannot map '${role}' to ${account.code} ${account.name}, which is not active. Reactivate the account or choose another.`,
      { organizationId, role, glAccountId }
    )
  }

  // The same table `resolveRoles` checks, at the same strictness, one step
  // earlier. See the JSDoc on `setRoleAssignment`.
  const expectedType = ROLE_ACCOUNT_TYPES[role]
  if (account.accountType !== expectedType) {
    throw new UnprocessableEntityError(
      `'${role}' must be mapped to a ${expectedType} account, but ${account.code} ${account.name} is a ${account.accountType} account.`,
      { organizationId, role, glAccountId }
    )
  }

  const confirmedAt = new Date()
  const [written] = await db
    .insert(schema.GlRoleAssignment)
    .values({
      organizationId,
      role,
      glAccountId,
      source: 'human',
      confirmedAt,
      confirmedByUserId: actorUserId ?? null,
      markedUnused: false,
    })
    .onConflictDoUpdate({
      target: [schema.GlRoleAssignment.organizationId, schema.GlRoleAssignment.role],
      set: {
        glAccountId,
        source: 'human',
        confirmedAt,
        confirmedByUserId: actorUserId ?? null,
        // Mapping a role IS using it. Leaving a stale `markedUnused` would make
        // `resolveRoles` refuse the account somebody just chose.
        markedUnused: false,
        updatedAt: new Date(),
      },
    })
    .returning({
      glAccountId: schema.GlRoleAssignment.glAccountId,
      source: schema.GlRoleAssignment.source,
      confirmedAt: schema.GlRoleAssignment.confirmedAt,
      markedUnused: schema.GlRoleAssignment.markedUnused,
    })

  return {
    role,
    state: 'confirmed',
    accountId: written?.glAccountId ?? glAccountId,
    account,
    source: written?.source ?? 'human',
    confirmedAt: toIso(written?.confirmedAt ?? confirmedAt),
  }
}

/**
 * Set or clear `markedUnused` on a role that already has a row.
 *
 * 🛑 There is no way to mark an UNMAPPED role unused, and that is a schema fact
 * rather than a choice made here: `GlRoleAssignment.glAccountId` is `NOT NULL`,
 * so a row cannot exist without naming an account. Refusing with a message that
 * says so beats inserting a placeholder id, which would dangle forever and read
 * to `resolveRoles` as "the account moved under the mapping".
 */
async function setUnusedFlag(
  db: Database,
  organizationId: string,
  role: AccountRole,
  markedUnused: boolean
): Promise<RoleAssignmentRow> {
  const [updated] = await db
    .update(schema.GlRoleAssignment)
    .set({ markedUnused, updatedAt: new Date() })
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        eq(schema.GlRoleAssignment.role, role)
      )
    )
    .returning({
      glAccountId: schema.GlRoleAssignment.glAccountId,
      source: schema.GlRoleAssignment.source,
      confirmedAt: schema.GlRoleAssignment.confirmedAt,
      markedUnused: schema.GlRoleAssignment.markedUnused,
    })

  if (!updated) {
    throw new NotFoundError(
      `'${role}' has no assignment to mark. Map it to an account first - GlRoleAssignment.glAccountId is NOT NULL, so a role cannot be marked unused before it names an account.`,
      { organizationId, role }
    )
  }

  if (updated.markedUnused) {
    return {
      role,
      state: 'unused',
      accountId: null,
      account: null,
      source: updated.source,
      confirmedAt: toIso(updated.confirmedAt),
    }
  }

  const accounts = await loadChartAccountsById(db, organizationId, [updated.glAccountId])
  return {
    role,
    state: updated.confirmedAt ? 'confirmed' : 'suggested',
    accountId: updated.glAccountId,
    account: accounts.get(updated.glAccountId) ?? null,
    source: updated.source,
    confirmedAt: toIso(updated.confirmedAt),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the chart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The by-id chart read, plus this module's decision to say so when an account
 * does not decode.
 *
 * The read itself is `chart-accounts.ts`'s - the same four attributes, the same
 * org-cache field lookup, the same archived-excluded-by-the-query rule and the
 * same decode `resolveRoles` gets, so the role map and the resolver cannot come
 * to disagree about what one account says.
 *
 * What is this module's own is the warning: a picker that silently omits an
 * account is a bug report nobody can file, so the ids are logged and a malformed
 * account is findable rather than merely invisible.
 */
async function loadChartAccountsById(
  db: Database,
  organizationId: string,
  accountIds: string[]
): Promise<Map<string, ChartAccountRow>> {
  return warnMalformed(
    organizationId,
    await readChartAccountsById(db, organizationId, accountIds, NOT_PROVISIONED)
  )
}

/** Log the accounts that carried no code or no type, then hand back the rest. */
function warnMalformed(
  organizationId: string,
  read: ChartAccountsRead
): Map<string, ChartAccountRow> {
  if (read.malformed.length > 0) {
    logger.warn('Skipped gl_account rows with no code or no type', {
      organizationId,
      glAccountIds: read.malformed.join(','),
    })
  }
  return read.accounts
}

/**
 * Serialise a timestamp column to ISO, tolerating a driver that already did.
 *
 * Same reasoning as `read-posting.ts`: Drizzle maps `timestamp` to a `Date`, a
 * stub or a raw pool can hand back the string, and an unparseable value becomes
 * `null` rather than the string `'Invalid Date'`, which a screen would render as
 * though it were a time.
 */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  const time = value.getTime()
  return Number.isNaN(time) ? null : value.toISOString()
}
