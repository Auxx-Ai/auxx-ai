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

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq, isNotNull, isNull } from 'drizzle-orm'
import { PgTransaction } from 'drizzle-orm/pg-core'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, BadRequestError, NotFoundError, UnprocessableEntityError } from '../errors'
import { getPaymentGateway } from '../payment-gateways/reads'
import { accountLabel, compareAccountsByCodeThenName } from './account-label'
import { withAccountingCommitLock } from './accounting-commit-lock'
import {
  ACCOUNT_ROLES,
  type AccountRole,
  ROLE_ACCOUNT_SUBTYPES,
  ROLE_ACCOUNT_TYPES,
  ROLES_WITHOUT_DEFAULT,
  roleScopeAxis,
  type ScopeAxis,
} from './build-entry'
import {
  type ChartAccountsRead,
  loadChartAccountFields,
  loadChartAccountsById as readChartAccountsById,
  readChartAccountValues,
} from './chart-accounts'
import { readRoleAssignments } from './role-assignments'
import { listRoleSources, type RoleSourceRow } from './source-scope'
import type {
  ChartAccountRow,
  RoleAssignmentRow,
  RoleAssignmentState,
  RoleSourceAssignmentRow,
} from './types'

export type { RoleSourceRow } from './source-scope'

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

/** Is `role` one of the declared roles - every role in `ACCOUNT_ROLES`, across five chart packs (16 §1)? The vocabulary is CLOSED. */
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
  db: Database | Transaction,
  organizationId: string
): Promise<Result<RoleAssignmentRow[], Error>> {
  try {
    const assignments = await readRoleAssignments(db, organizationId)

    // The org DEFAULT per role, and the per-source overrides beside it. Both
    // come out of the one query - the same partition `resolveRoles` makes, so
    // the screen and the resolver cannot disagree about which row is which.
    // `== null` catches BOTH null and undefined - see `resolve-roles.ts` on why
    // "absent" has to read as the org default however the driver spells it.
    //
    // 🛑 `paymentGatewayId == null` too. A rail row (task 58) also carries
    // `sourceAccountId: null`, and without this a role with both an org
    // default and a rail override would collide on this Map's key - two DB
    // rows are legal (different partial unique indexes), one Map slot is not.
    // Rail rows are dropped here rather than shown as overrides: this read
    // does not understand the rail axis yet (U1c, U8), so silence is the
    // honest answer until it does.
    const byRole = new Map(
      assignments
        .filter((row) => row.sourceAccountId == null && row.paymentGatewayId == null)
        .map((row) => [row.role, row])
    )
    const overridesByRole = new Map<string, typeof assignments>()
    for (const row of assignments) {
      if (row.sourceAccountId == null) continue
      const list = overridesByRole.get(row.role) ?? []
      list.push(row)
      overridesByRole.set(row.role, list)
    }

    // Only the accounts a mapping actually names. An org with no assignments
    // reads no chart at all, which is what keeps a fresh org's role map a list
    // of every role `unmapped` rather than a provisioning error.
    const accountIds = [...new Set(assignments.map((row) => row.glAccountId))]
    const accounts = await loadChartAccountsById(db, organizationId, accountIds)

    /**
     * One role's overrides, ordered by source id so the list is stable between
     * reads. The SCREEN orders them by source NAME - it is the side that holds
     * the names - and pins Manual first; this only has to be deterministic.
     */
    const overridesFor = (role: string): RoleSourceAssignmentRow[] =>
      (overridesByRole.get(role) ?? [])
        .slice()
        .sort((a, b) => (a.sourceAccountId ?? '').localeCompare(b.sourceAccountId ?? ''))
        .map((row) => ({
          sourceAccountId: row.sourceAccountId as string,
          state: row.confirmedAt ? ('confirmed' as const) : ('suggested' as const),
          accountId: row.glAccountId,
          account: accounts.get(row.glAccountId) ?? null,
          source: row.source,
          confirmedAt: toIso(row.confirmedAt),
        }))

    const rows: RoleAssignmentRow[] = ALL_ROLES.map((role) => {
      const assignment = byRole.get(role)
      const axis = roleScopeAxis(role)
      const overrides = overridesFor(role)
      if (!assignment) {
        return {
          role,
          state: 'unmapped',
          accountId: null,
          account: null,
          source: null,
          confirmedAt: null,
          axis,
          overrides,
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
          axis,
          overrides,
        }
      }

      return {
        role,
        state,
        accountId: assignment.glAccountId,
        account: accounts.get(assignment.glAccountId) ?? null,
        source: assignment.source,
        confirmedAt: toIso(assignment.confirmedAt),
        axis,
        overrides,
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
 * An account missing `gl_account_type` is SKIPPED and logged rather than
 * defaulted - guessing a type would defeat the compatibility check that is the
 * only reason the type is read. A missing or blank `gl_account_code` is no
 * longer a reason to skip (task 15 §5): the account id is the identity, and a
 * code is a label the account may not carry. The log line names the ids so a
 * malformed account is findable rather than merely invisible.
 *
 * Ordered by code then name (task 15 §5's 15.2 default): a coded account
 * before an uncoded one, then alphabetically within each.
 */
/** Options for {@link listChartAccounts}. */
export interface ListChartAccountsOptions {
  /**
   * Include accounts that have been removed (archived). Default false.
   *
   * 🛑 The settings list is the ONLY caller that may pass true. An archived
   * account is removed as far as posting is concerned, and handing one to the
   * resolver, the role picker or a preview would put money into an account
   * somebody deliberately took out of the chart.
   */
  includeArchived?: boolean
}

export async function listChartAccounts(
  db: Database | Transaction,
  organizationId: string,
  options: ListChartAccountsOptions = {}
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

    // 🛑 The archived filter is in the QUERY and stays there by default. Every
    // reader but the settings list depends on it - `resolveRoles` picking a
    // removed account would post real money into it - so `includeArchived` widens
    // this one call rather than the readers filtering afterwards.
    const instances = await db
      .select({ id: schema.EntityInstance.id, archivedAt: schema.EntityInstance.archivedAt })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, glAccountDefId),
          ...(options.includeArchived ? [] : [isNull(schema.EntityInstance.archivedAt)])
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

    // `archivedAt` lives on the instance, not among the account's attributes, so
    // the decoder cannot know it. Stamped here, and only when it can be true.
    if (options.includeArchived) {
      for (const row of instances) {
        if (!row.archivedAt) continue
        const account = accounts.get(row.id)
        if (account) account.isArchived = true
      }
    }

    return ok([...accounts.values()].sort(compareAccountsByCodeThenName))
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to list the chart of accounts', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * How many posted lines landed on each account, by `glAccountId`.
 *
 * The one number the chart's renumber warning needs. A posting line stores the
 * account id with **no foreign key** (task 15: the IDENTITY), so a line
 * outlives the chart row it was posted against - which means a deleted account
 * can still carry posted history. That is a feature, and it is also the kind
 * of feature a person should be told about with a NUMBER rather than a
 * caution: "142 posted lines carry this account" is what makes the trade
 * concrete.
 *
 * ⚠️ **Keyed on `glAccountId`, not on code**, because renumbering no longer
 * fragments an account's history (task 15 §3) - "how many posted lines landed
 * on THIS account" is exactly the question a renumber warning has to answer,
 * and the id answers it precisely where a code answer used to undercount an
 * account renumbered since some of its lines posted. An account never posted
 * to reports nothing; a deleted account whose id is no longer in the live
 * chart still reports its true count, findable by whoever kept the id.
 *
 * 🛑 Deliberately NOT folded into {@link listChartAccounts}. `ChartAccountRow` is
 * shared with `resolveRoles`' path and decoded by every reader of this chart; a
 * field only the settings screen renders does not belong on it.
 */
export async function listChartAccountUsage(
  db: Database | Transaction,
  organizationId: string
): Promise<Result<Record<string, number>, Error>> {
  try {
    const rows = await db
      .select({
        glAccountId: schema.GlPostingLine.glAccountId,
        lines: count(),
      })
      .from(schema.GlPostingLine)
      .where(eq(schema.GlPostingLine.organizationId, organizationId))
      .groupBy(schema.GlPostingLine.glAccountId)

    const usage: Record<string, number> = {}
    for (const row of rows) {
      if (row.glAccountId) usage[row.glAccountId] = Number(row.lines) || 0
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

/** What one role-map edit is asking for. Exactly one of the four modes below. */
export interface SetRoleAssignmentOptions {
  organizationId: string
  /** An `ACCOUNT_ROLES` value. Anything else is a `BadRequestError`. */
  role: string
  /** The `gl_account` instance to point the role at. Validated before writing. */
  glAccountId?: string | null
  /** `true` marks the role unused; `false` clears that mark. */
  markedUnused?: boolean
  /**
   * Scope this edit to ONE source instead of the org default (task 47 §7.3).
   *
   * A `FinancialSourceAccount.id`, including the MANUAL bucket, which is a real
   * row like any other. Absent edits the org-wide default, which is what every
   * call meant before this brief.
   *
   * 🛑 Refused on a role outside `SCOPABLE_ROLES`, naming the role. The
   * vocabulary of what may be scoped is as closed as the role vocabulary itself,
   * and for the same reason: a scope only means something if the posting path
   * reads that axis. Exclusive with {@link paymentGatewayId} - `GlRoleAssignment
   * _scope_exclusive_check` refuses both at once (task 58 §3 rule 1).
   */
  sourceAccountId?: string | null
  /**
   * Scope this edit to ONE payment rail instead of the org default (task 58 §3).
   *
   * A `payment_gateway` EntityInstance id, live and this org's. Refused on a
   * role whose `SCOPABLE_ROLES` axis is not `'rail'` - `clearing`, `bank` and
   * `payment_processing_fees` today. Exclusive with {@link sourceAccountId}.
   */
  paymentGatewayId?: string | null
  /**
   * Further scope a {@link paymentGatewayId} row to one settlement currency.
   * Requires {@link paymentGatewayId} and a three-letter code - both are the
   * `GlRoleAssignment` CHECK constraints named on the column.
   */
  currency?: string | null
  /**
   * Drop this scope's override and go back to what it falls back to ("Use the
   * default account"). Requires {@link sourceAccountId} or {@link paymentGatewayId}.
   *
   * ⚠️ A DELETE, not a write of the default's account id. Inheriting is the
   * absence of a row, so an override copied from the default would silently stop
   * following it the next time somebody repointed the role.
   */
  useDefault?: boolean
  /** Who is doing this. Stamped as `confirmedByUserId` when a mapping is set. */
  actorUserId?: string
}

/**
 * Point one role at one account, or mark it unused - upserting the single row
 * one of three unique indexes permits.
 *
 * Modes, and the arguments pick exactly one:
 *
 * | Call | Effect |
 * | --- | --- |
 * | `{ role, glAccountId }` | map the org default: `source: 'human'`, `confirmedAt: now`, `confirmedByUserId`, `markedUnused: false` |
 * | `{ role, markedUnused: true }` | mark it unused, keeping the account it already names |
 * | `{ role, markedUnused: false }` | clear the unused mark, restoring whatever it was before |
 * | `{ role, sourceAccountId, glAccountId }` | map that connection's override (store axis) |
 * | `{ role, paymentGatewayId, currency?, glAccountId }` | map that rail's override (rail axis, task 58 §3) |
 *
 * `glAccountId` together with `markedUnused: true` is a contradiction - "use
 * this account" and "we do not use this role" - and is refused rather than
 * silently resolved in one direction. `sourceAccountId` and `paymentGatewayId`
 * together is the same kind of contradiction one scope over - two answers to
 * "which scope" - and `GlRoleAssignment_scope_exclusive_check` is the same
 * refusal one layer down if this one is ever bypassed.
 *
 * ## What is validated before anything is written
 *
 * - the role is in `ACCOUNT_ROLES` (`BadRequestError`). The vocabulary is CLOSED:
 *   an org may renumber, rename or replace the ACCOUNT behind a role, it may not
 *   invent a role, because a role only means something if a builder emits it.
 * - `sourceAccountId` and `paymentGatewayId` are not both given (`BadRequestError`)
 * - `currency` is not given without `paymentGatewayId`, and matches `^[A-Z]{3}$`
 *   when it is given (`BadRequestError`) - the same two CHECK constraints named
 *   on the column
 * - a `paymentGatewayId` names a role whose `SCOPABLE_ROLES` axis is `'rail'`,
 *   and a `sourceAccountId` one whose axis is `'store'` (`BadRequestError`,
 *   naming the role and the scope it should have used instead)
 * - `bank` (any role in `ROLES_WITHOUT_DEFAULT`) is never written with no scope
 *   at all - it has no org-wide answer (`BadRequestError`, task 58 §3 rule 3)
 * - the account exists in THIS org and is not archived (`UnprocessableEntityError`)
 * - the account is active (`UnprocessableEntityError`)
 * - the account's `accountType` matches `ROLE_ACCOUNT_TYPES[role]`
 *   (`UnprocessableEntityError`, naming the role, the account and both types)
 * - the account's `subtype` matches `ROLE_ACCOUNT_SUBTYPES[role]`, for the two
 *   roles that pin one (`UnprocessableEntityError`, task 58 §3 rule 4)
 *
 * The type check is the one that matters most. `resolveRoles` performs the
 * identical check at post time off the identical table, and if this write did
 * not, the first anyone would learn of the mismatch is a refused close. An
 * entry posted to the wrong KIND of account still balances, so there is no
 * downstream reader that could catch it.
 *
 * 🛑 `source: 'human'` and a `confirmedAt` stamp are written only in the mapping
 * modes. Marking a role unused is not a confirmation of the account behind it,
 * and stamping one would erase the `G19` distinction the wizard renders -
 * "we chose this for you" versus "you chose this".
 *
 * @returns the role's row as {@link listRoleMap} would render it afterwards -
 * except for a `paymentGatewayId` write, whose rail is not in that checklist
 * yet (58 §6, U8). That write's own row is complete; it just cannot be shown
 * beside the org default until then.
 */
export async function setRoleAssignment(
  db: Database | Transaction,
  options: SetRoleAssignmentOptions
): Promise<Result<RoleAssignmentRow, Error>> {
  return db instanceof PgTransaction
    ? setRoleAssignmentInTx(db, options)
    : db.transaction((tx) => setRoleAssignmentInTx(tx, options))
}

async function setRoleAssignmentInTx(
  db: Transaction,
  options: SetRoleAssignmentOptions
): Promise<Result<RoleAssignmentRow, Error>> {
  await withAccountingCommitLock(db, options.organizationId)
  const { organizationId, role, actorUserId } = options
  const glAccountId = options.glAccountId?.trim() || null
  const markedUnused = options.markedUnused
  const sourceAccountId = options.sourceAccountId?.trim() || null
  const paymentGatewayId = options.paymentGatewayId?.trim() || null
  const currency = options.currency?.trim() || null

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

    // 🛑 The three scope refusals below are checked before either scope branch
    // runs, and before the role-specific ones: naming both scopes, or a
    // currency with neither, is wrong regardless of which role or account is
    // involved (`GlRoleAssignment_scope_exclusive_check` and
    // `_currency_rail_check` one layer down).
    if (sourceAccountId && paymentGatewayId) {
      throw new BadRequestError(
        `Cannot map '${role}' to a connection and a payment gateway at once. Send one or the other.`,
        { organizationId, role }
      )
    }
    if (currency && !paymentGatewayId) {
      throw new BadRequestError(
        `'${role}' cannot carry a currency without a payment gateway - currency only qualifies a rail.`,
        { organizationId, role }
      )
    }
    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestError(
        `'${currency}' is not a three-letter currency code for '${role}'.`,
        {
          organizationId,
          role,
          currency,
        }
      )
    }

    if (paymentGatewayId) {
      // 🛑 Every scoped refusal is checked BEFORE anything is written, and
      // each names the role: a scope that only fails at a close fails on the
      // night of the close, which is `setRoleAssignment`'s whole argument.
      await assertScopableGateway(db, organizationId, role, paymentGatewayId)
      if (markedUnused !== undefined) {
        throw new BadRequestError(
          `'${role}' can only be marked unused for the whole organization, not for one payment ` +
            'gateway - that is a fact about the business, not about one rail.',
          { organizationId, role }
        )
      }
      if (options.useDefault) {
        return ok(await clearGatewayRole(db, organizationId, role, paymentGatewayId, currency))
      }
      if (!glAccountId) {
        throw new BadRequestError(
          `Nothing to set for '${role}' on this payment gateway. Send an account, or useDefault.`,
          { organizationId, role }
        )
      }
      return ok(
        await mapGatewayRole(
          db,
          organizationId,
          role,
          glAccountId,
          actorUserId,
          paymentGatewayId,
          currency
        )
      )
    }

    if (sourceAccountId) {
      // 🛑 Every scoped refusal is checked BEFORE anything is written, and
      // each names the role: a scope that only fails at a close fails on the
      // night of the close, which is `setRoleAssignment`'s whole argument.
      const axis = await assertScopableSource(db, organizationId, role, sourceAccountId)
      if (markedUnused !== undefined) {
        throw new BadRequestError(
          `'${role}' can only be marked unused for the whole organization, not for one connection. ` +
            '"We do not sell shipping" is a fact about the business, not about one store.',
          { organizationId, role }
        )
      }
      if (options.useDefault) {
        return ok(await clearScopedRole(db, organizationId, role, sourceAccountId))
      }
      if (!glAccountId) {
        throw new BadRequestError(
          `Nothing to set for '${role}' on this connection. Send an account, or useDefault.`,
          { organizationId, role }
        )
      }
      return ok(
        await mapRole(db, organizationId, role, glAccountId, actorUserId, sourceAccountId, axis)
      )
    }

    if (options.useDefault) {
      throw new BadRequestError(
        `'${role}' has no connection or payment gateway to clear. useDefault needs the scope it applies to.`,
        { organizationId, role }
      )
    }

    if (glAccountId) {
      // §3 rule 3: `bank` (and anything else in `ROLES_WITHOUT_DEFAULT`) has no
      // answer that holds for the whole org, so this is the one write that mode
      // must always refuse, unscoped, before it ever reaches `mapRole`.
      if ((ROLES_WITHOUT_DEFAULT as readonly string[]).includes(role)) {
        throw new BadRequestError(
          `'${role}' has no organization-wide default - map it to a payment gateway instead. ` +
            'Send paymentGatewayId.',
          { organizationId, role }
        )
      }
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
 * Existence, active status, statement type and (for the two roles that pin
 * one) subtype - every check a role-map write makes on the account it is
 * about to name, shared by every write mode.
 *
 * The type and subtype checks are the ones that matter. `resolveRoles`
 * performs the identical checks at post time off the identical table, and if
 * this write did not, the first anyone would learn of the mismatch is a
 * refused close. An entry posted to the wrong KIND of account still balances,
 * so there is no downstream reader that could catch it.
 */
async function assertMappableAccount(
  db: Database | Transaction,
  organizationId: string,
  role: AccountRole,
  glAccountId: string
): Promise<ChartAccountRow> {
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
      `Cannot map '${role}' to ${accountLabel(account)}, which is not active. Reactivate the account or choose another.`,
      { organizationId, role, glAccountId }
    )
  }

  const expectedType = ROLE_ACCOUNT_TYPES[role]
  if (account.accountType !== expectedType) {
    throw new UnprocessableEntityError(
      `'${role}' must be mapped to a ${expectedType} account, but ${accountLabel(account)} is a ${account.accountType} account.`,
      { organizationId, role, glAccountId }
    )
  }

  // §3 rule 4: a second, narrower pin beside the type, present for `bank` and
  // `clearing` only. `ChartAccountRow.subtype` is already loaded above - no
  // second chart read.
  const expectedSubtype = ROLE_ACCOUNT_SUBTYPES[role]
  if (expectedSubtype && account.subtype !== expectedSubtype) {
    throw new UnprocessableEntityError(
      `'${role}' must be mapped to a '${expectedSubtype}' account, but ${accountLabel(account)} is ` +
        `${account.subtype ? `a '${account.subtype}' account` : 'not marked with a subtype'}.`,
      { organizationId, role, glAccountId }
    )
  }

  return account
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
  db: Database | Transaction,
  organizationId: string,
  role: AccountRole,
  glAccountId: string,
  actorUserId: string | undefined,
  sourceAccountId?: string,
  axis?: ScopeAxis
): Promise<RoleAssignmentRow> {
  const account = await assertMappableAccount(db, organizationId, role, glAccountId)

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
      sourceAccountId: sourceAccountId ?? null,
    })
    // 🛑 The unique index this upsert rides became TWO partial indexes in
    // task 47, so the target has to name which one. The default half is
    // `(organizationId, role) WHERE sourceAccountId IS NULL`; the scoped half
    // adds the source and inverts the predicate. Naming the wrong one, or
    // neither, turns a concurrent editor's second write into a duplicate row -
    // the ONE state `resolveRoles` refuses outright rather than choosing
    // between.
    .onConflictDoUpdate(
      sourceAccountId
        ? {
            target: [
              schema.GlRoleAssignment.organizationId,
              schema.GlRoleAssignment.role,
              schema.GlRoleAssignment.sourceAccountId,
            ],
            targetWhere: isNotNull(schema.GlRoleAssignment.sourceAccountId),
            set: {
              glAccountId,
              source: 'human',
              confirmedAt,
              confirmedByUserId: actorUserId ?? null,
              markedUnused: false,
              updatedAt: new Date(),
            },
          }
        : {
            target: [schema.GlRoleAssignment.organizationId, schema.GlRoleAssignment.role],
            // ⚠️ Both halves, matching `GlRoleAssignment_org_role_default_key` after task
            // 58 widened it. A predicate narrower than the index infers nothing (42P10).
            targetWhere: and(
              isNull(schema.GlRoleAssignment.sourceAccountId),
              isNull(schema.GlRoleAssignment.paymentGatewayId)
            ),
            set: {
              glAccountId,
              source: 'human',
              confirmedAt,
              confirmedByUserId: actorUserId ?? null,
              // Mapping a role IS using it. Leaving a stale `markedUnused` would
              // make `resolveRoles` refuse the account somebody just chose.
              markedUnused: false,
              updatedAt: new Date(),
            },
          }
    )
    .returning({
      glAccountId: schema.GlRoleAssignment.glAccountId,
      source: schema.GlRoleAssignment.source,
      confirmedAt: schema.GlRoleAssignment.confirmedAt,
      markedUnused: schema.GlRoleAssignment.markedUnused,
    })

  // ⚠️ A SCOPED write returns the role's row with this override folded in, not
  // a row describing the override alone. The caller asked "what does this role
  // look like now", and the default it still falls back to is half the answer.
  if (sourceAccountId) {
    const current = await readRoleRow(db, organizationId, role)
    return {
      ...current,
      axis: axis ?? current.axis,
      overrides: [
        ...current.overrides.filter((row) => row.sourceAccountId !== sourceAccountId),
        {
          sourceAccountId,
          state: 'confirmed' as const,
          accountId: written?.glAccountId ?? glAccountId,
          account,
          source: written?.source ?? 'human',
          confirmedAt: toIso(written?.confirmedAt ?? confirmedAt),
        },
      ].sort((a, b) => a.sourceAccountId.localeCompare(b.sourceAccountId)),
    }
  }

  return {
    role,
    state: 'confirmed',
    accountId: written?.glAccountId ?? glAccountId,
    account,
    source: written?.source ?? 'human',
    confirmedAt: toIso(written?.confirmedAt ?? confirmedAt),
    axis: roleScopeAxis(role),
    // ⚠️ Read rather than assumed empty. Repointing the DEFAULT leaves every
    // override standing - that is what an override is - and a row that came back
    // claiming none would make the settings tree drop them until the next
    // refetch.
    overrides: await readRoleOverrides(db, organizationId, role),
  }
}

/**
 * One role's per-source overrides, resolved for display.
 *
 * 🛑 Its own narrow read rather than {@link listRoleMap}: a write already holds
 * the row it wrote, and re-deriving the whole checklist to answer "what else
 * does this role carry" would be a second pass over every role in the org.
 * `clearScopedRole` and the scoped branch of `mapRole` are the exceptions - they
 * need the role's DEFAULT too, which only the list read has.
 */
async function readRoleOverrides(
  db: Database | Transaction,
  organizationId: string,
  role: AccountRole
): Promise<RoleSourceAssignmentRow[]> {
  const rows = await db
    .select({
      glAccountId: schema.GlRoleAssignment.glAccountId,
      source: schema.GlRoleAssignment.source,
      confirmedAt: schema.GlRoleAssignment.confirmedAt,
      sourceAccountId: schema.GlRoleAssignment.sourceAccountId,
    })
    .from(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        eq(schema.GlRoleAssignment.role, role),
        isNotNull(schema.GlRoleAssignment.sourceAccountId)
      )
    )
  const scoped = rows.filter((row) => row.sourceAccountId != null)
  if (scoped.length === 0) return []
  const accounts = await loadChartAccountsById(
    db,
    organizationId,
    scoped.map((row) => row.glAccountId)
  )
  return scoped
    .map((row) => ({
      sourceAccountId: row.sourceAccountId as string,
      state: row.confirmedAt ? ('confirmed' as const) : ('suggested' as const),
      accountId: row.glAccountId,
      account: accounts.get(row.glAccountId) ?? null,
      source: row.source,
      confirmedAt: toIso(row.confirmedAt),
    }))
    .sort((a, b) => a.sourceAccountId.localeCompare(b.sourceAccountId))
}

/**
 * Validate a store-scoped edit before anything is written, and answer the
 * role's axis. The rail equivalent is {@link assertScopableGateway}.
 *
 * Three refusals, each with its own sentence, because they send three
 * different people to three different places (task 47 §4, §7.4; narrowed to
 * the store axis by task 58 §3, which moved every rail role onto
 * `paymentGatewayId` instead):
 *
 * | Condition | What the reader has to do about it |
 * | --- | --- |
 * | the role is not scopable at all | nothing - `accounts_receivable` is settled by cash, not by store |
 * | the role is scoped, but by rail | send `paymentGatewayId` instead |
 * | the source is not this org's, is archived, or is not `live` | pick a live connection |
 * | the source does not carry store evidence | 🛑 a revenue role pointed at a merchant account with no storefront behind it |
 *
 * The last is the one that matters, and it is why this returns the axis rather
 * than a boolean: a settings screen offers only the sources on the store axis,
 * but that filter is a CONVENIENCE, and a write pairing a Stripe account with
 * `revenue_product` has to be refused by the server that would otherwise store
 * it.
 */
async function assertScopableSource(
  db: Database | Transaction,
  organizationId: string,
  role: AccountRole,
  sourceAccountId: string
): Promise<ScopeAxis> {
  const axis = roleScopeAxis(role)
  if (!axis) {
    throw new BadRequestError(
      `'${role}' is answered once for the whole organization and cannot be set per connection. ` +
        'Only product revenue, shipping revenue and returns and allowances can differ by connection.',
      { organizationId, role }
    )
  }
  if (axis !== 'store') {
    throw new BadRequestError(
      `'${role}' is scoped by payment gateway, not by connection. Send paymentGatewayId instead.`,
      { organizationId, role }
    )
  }

  const sources = await listRoleSources(db, organizationId)
  const source = sources.find((row) => row.id === sourceAccountId)
  if (!source) {
    throw new UnprocessableEntityError(
      `Cannot set '${role}' for that connection: it is not a live connection of this organization, ` +
        'or it has been removed.',
      { organizationId, role, sourceAccountId }
    )
  }
  if (!source.axes.includes(axis)) {
    throw new UnprocessableEntityError(
      `Cannot set '${role}' for ${source.name}: revenue belongs to the storefront that sold it, ` +
        'and nothing has ever been sold through that connection.',
      { organizationId, role, sourceAccountId }
    )
  }
  return axis
}

/**
 * Validate a rail-scoped edit before anything is written - the rail mirror of
 * {@link assertScopableSource}. Two refusals:
 *
 * | Condition | What the reader has to do about it |
 * | --- | --- |
 * | the role's axis is not `'rail'` | send `sourceAccountId`, or nothing at all, instead |
 * | the gateway is not this org's, or is archived | pick a live payment gateway |
 */
async function assertScopableGateway(
  db: Database | Transaction,
  organizationId: string,
  role: AccountRole,
  paymentGatewayId: string
): Promise<ScopeAxis> {
  const axis = roleScopeAxis(role)
  if (axis !== 'rail') {
    throw new BadRequestError(
      axis === 'store'
        ? `'${role}' is scoped by connection, not by payment gateway. Send sourceAccountId instead.`
        : `'${role}' is answered once for the whole organization and cannot be scoped to a payment gateway.`,
      { organizationId, role }
    )
  }

  const gateway = await getPaymentGateway(db, organizationId, paymentGatewayId)
  if (gateway.isErr()) throw gateway.error
  if (!gateway.value) {
    throw new UnprocessableEntityError(
      `Cannot set '${role}' for that payment gateway: it is not a live payment gateway of this ` +
        'organization, or it has been removed.',
      { organizationId, role, paymentGatewayId }
    )
  }
  return axis
}

/**
 * Delete one source's override, so it inherits the org default again.
 *
 * 🛑 Absent, not blank. A row carrying the default's account id would read as
 * an override for as long as the default stayed put and then quietly stop
 * following it - which is precisely the drift "use the default" is being pressed
 * to end.
 *
 * Deleting an override that is not there is a no-op rather than a `NotFoundError`:
 * the button is pressed on a screen, and the state it asks for is the state that
 * already holds.
 */
async function clearScopedRole(
  db: Database | Transaction,
  organizationId: string,
  role: AccountRole,
  sourceAccountId: string
): Promise<RoleAssignmentRow> {
  await db
    .delete(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        eq(schema.GlRoleAssignment.role, role),
        eq(schema.GlRoleAssignment.sourceAccountId, sourceAccountId)
      )
    )
  return readRoleRow(db, organizationId, role)
}

/**
 * Point one role at one account for one rail (a payment gateway, optionally
 * further scoped to a currency) - the rail mirror of {@link mapRole}.
 *
 * Explicit select-then-write rather than `onConflictDoUpdate`:
 * `GlRoleAssignment_org_role_rail_key` keys on `coalesce(currency, '')`, and
 * Drizzle's upsert target cannot address an expression index
 * (`identity/upsert.ts` made the same call for the same reason). Safe against
 * a concurrent editor anyway - `setRoleAssignmentInTx` already holds
 * `withAccountingCommitLock` for the whole org before this runs.
 */
async function mapGatewayRole(
  db: Database | Transaction,
  organizationId: string,
  role: AccountRole,
  glAccountId: string,
  actorUserId: string | undefined,
  paymentGatewayId: string,
  currency: string | null
): Promise<RoleAssignmentRow> {
  const account = await assertMappableAccount(db, organizationId, role, glAccountId)
  const confirmedAt = new Date()

  const [existing] = await db
    .select({ id: schema.GlRoleAssignment.id })
    .from(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        eq(schema.GlRoleAssignment.role, role),
        eq(schema.GlRoleAssignment.paymentGatewayId, paymentGatewayId),
        currency
          ? eq(schema.GlRoleAssignment.currency, currency)
          : isNull(schema.GlRoleAssignment.currency)
      )
    )
    .limit(1)

  if (existing) {
    await db
      .update(schema.GlRoleAssignment)
      .set({
        glAccountId,
        source: 'human',
        confirmedAt,
        confirmedByUserId: actorUserId ?? null,
        markedUnused: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.GlRoleAssignment.id, existing.id))
  } else {
    await db.insert(schema.GlRoleAssignment).values({
      organizationId,
      role,
      glAccountId,
      source: 'human',
      confirmedAt,
      confirmedByUserId: actorUserId ?? null,
      markedUnused: false,
      paymentGatewayId,
      currency,
    })
  }

  return {
    role,
    state: 'confirmed',
    accountId: glAccountId,
    account,
    source: 'human',
    confirmedAt: toIso(confirmedAt),
    axis: 'rail',
    // 🛑 Rail scopes aren't in this shape yet. `RoleSourceAssignmentRow` is
    // keyed on `sourceAccountId`, and a settings screen showing this rail
    // beside the org default is 58 §6 (U8). This write's own answer is
    // complete; the checklist just cannot fold it in until then.
    overrides: [],
  }
}

/**
 * Delete one rail's override, so it falls back to the next link in the chain
 * (§3 rule 2) - the rail mirror of {@link clearScopedRole}.
 *
 * Returns the deletion alone, not the row it falls back to: resolving that
 * chain is `resolve-roles.ts`'s read (U2), and this file's own read,
 * `listRoleMap`, does not follow rail rows yet either (U1c, U8).
 */
async function clearGatewayRole(
  db: Database | Transaction,
  organizationId: string,
  role: AccountRole,
  paymentGatewayId: string,
  currency: string | null
): Promise<RoleAssignmentRow> {
  await db
    .delete(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        eq(schema.GlRoleAssignment.role, role),
        eq(schema.GlRoleAssignment.paymentGatewayId, paymentGatewayId),
        currency
          ? eq(schema.GlRoleAssignment.currency, currency)
          : isNull(schema.GlRoleAssignment.currency)
      )
    )
  return {
    role,
    state: 'unmapped',
    accountId: null,
    account: null,
    source: null,
    confirmedAt: null,
    axis: 'rail',
    overrides: [],
  }
}

/**
 * One role's row as {@link listRoleMap} renders it.
 *
 * Through `listRoleMap` itself rather than a second query, so a write's answer
 * and the list the screen refetches cannot disagree about the same role - the
 * same reason `loadChartAccountsById` is shared with the resolver.
 */
async function readRoleRow(
  db: Database | Transaction,
  organizationId: string,
  role: AccountRole
): Promise<RoleAssignmentRow> {
  const rows = await listRoleMap(db, organizationId)
  if (rows.isErr()) throw rows.error
  const row = rows.value.find((item) => item.role === role)
  if (!row) {
    // Unreachable: `listRoleMap` returns a row for every declared role, and
    // `isAccountRole` already refused anything else.
    throw new NotFoundError(`'${role}' has no row in the role map.`, { organizationId, role })
  }
  return row
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
  db: Database | Transaction,
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
        eq(schema.GlRoleAssignment.role, role),
        // 🛑 The org DEFAULT row. Marking a role unused says "we do not sell
        // shipping", which is a fact about the BUSINESS - it cannot be true of
        // one store and false of another, so there is no per-source version of
        // it and the settings tree offers none (task 47 §7.1).
        isNull(schema.GlRoleAssignment.sourceAccountId),
        isNull(schema.GlRoleAssignment.paymentGatewayId)
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

  // 🛑 Built from what the UPDATE returned, never re-read. The row in hand is
  // the row that was just written; a second read would be one more query for an
  // answer that cannot differ.
  const overrides = await readRoleOverrides(db, organizationId, role)
  const axis = roleScopeAxis(role)

  if (updated.markedUnused) {
    return {
      role,
      state: 'unused',
      accountId: null,
      account: null,
      source: updated.source,
      confirmedAt: toIso(updated.confirmedAt),
      axis,
      overrides,
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
    axis,
    overrides,
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
  db: Database | Transaction,
  organizationId: string,
  accountIds: string[]
): Promise<Map<string, ChartAccountRow>> {
  return warnMalformed(
    organizationId,
    await readChartAccountsById(db, organizationId, accountIds, NOT_PROVISIONED)
  )
}

/** Log the accounts that carried no type, then hand back the rest. */
function warnMalformed(
  organizationId: string,
  read: ChartAccountsRead
): Map<string, ChartAccountRow> {
  if (read.malformed.length > 0) {
    logger.warn('Skipped gl_account rows with no type', {
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
