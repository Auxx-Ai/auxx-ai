// packages/lib/src/postings/chart-write.ts

/**
 * The chart of accounts, WRITTEN: create, update and remove one `gl_account`.
 *
 * `G7` has said the chart is the org's own document since it was seeded, and
 * every piece of machinery downstream is built on that premise - `G8` exists
 * only because the chart is editable, and `GlPostingLine.accountCode` has no
 * foreign key only because the chart is editable. Until this file there was no
 * writer but `seedDefaultChartOfAccounts`, which runs once at migration time.
 *
 * ## The invariant this module exists for
 *
 * 🛑 `mapRole` (`role-map.ts`) validates the pair (role, account) from the
 * ROLE's side: not archived, active, and `accountType === ROLE_ACCOUNT_TYPES[role]`.
 * `resolveRoles` re-checks the identical three at post time. **Editing the
 * account is the other half of that pair**, and every one of those checks is
 * bypassable without the guards below: map `grni` to a liability account, then
 * change that account's type to `revenue`. Both writes pass, the resulting entry
 * still BALANCES, and nothing downstream can detect it - which is exactly what
 * `ROLE_ACCOUNT_TYPES`' header says about a type mismatch.
 *
 * So this file owns the same three refusals from the account's side ({@link I1},
 * {@link I2}, {@link I3} below), plus code uniqueness, which the handler gives.
 *
 * ## What is deliberately NOT guarded
 *
 * ⚠️ **`code` and `name` are the org's, unconditionally.** Both are safe:
 *
 * - a RENAME cannot touch history - `GlPostingLine.accountName` is a snapshot
 *   taken at post time, for exactly this reason
 * - a RENUMBER cannot touch role resolution - `GlRoleAssignment.glAccountId`
 *   names the INSTANCE, not the code, which is `G8` doing its job
 *
 * What a renumber does do is detach every line already posted from the row on
 * screen, because a posted line stores the code with no foreign key. That is
 * decision `P2` working as designed - the ledger outlives the chart - and it is
 * not this module's business to refuse it. It is the UI's business to say so,
 * with a count (`listChartAccountUsage` in `role-map.ts`).
 *
 * ## Removal is ARCHIVE, never delete
 *
 * See {@link removeChartAccount}. Three independent reasons, any one sufficient.
 *
 * No permission checks here. The router asserts `ledgerPost`
 * (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import {
  AuxxError,
  BadRequestError,
  NotFoundError,
  UniqueValueConflictError,
  UnprocessableEntityError,
} from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { toRecordId } from '../resources/resource-id'
import { ACCOUNT_ROLE_LABELS, type AccountRole, ROLE_ACCOUNT_TYPES } from './build-entry'
import {
  type ChartAccountFields,
  loadChartAccountFields,
  readChartAccountValues,
} from './chart-accounts'
import type { GlAccountTypeValue } from './default-chart'
import type { ChartAccountRow } from './types'

const logger = createScopedLogger('postings:chart-write')

/**
 * What an unprovisioned chart refuses a WRITER with.
 *
 * `role-map.ts` and `resolve-roles.ts` each pass their own sentence to the same
 * shared check, deliberately - the fact is one, the advice is not. This one is
 * read by somebody who just clicked Create.
 */
const NOT_PROVISIONED =
  'The chart of accounts is not provisioned for this organization - gl_account_code / gl_account_type are missing. Run the entity migrations.'

/**
 * The four `gl_account` attributes, as the crud handler wants them keyed.
 *
 * A `type` and not an `interface`: the handler takes `Record<string, unknown>`,
 * and only a type alias carries the implicit index signature that satisfies it.
 */
type AccountValues = {
  gl_account_code?: string
  gl_account_name?: string
  gl_account_type?: GlAccountTypeValue
  gl_account_is_active?: boolean
}

/** A role that still posts to an account, and the account row it points at. */
interface LiveRole {
  role: AccountRole
  glAccountId: string
}

export interface CreateChartAccountOptions {
  organizationId: string
  /** The account number. Unique per org; `UniqueValueConflictError` if taken. */
  code: string
  name: string
  accountType: GlAccountTypeValue
  /** Defaults to `true`, matching the field's registry default. */
  isActive?: boolean
  /** Who is doing this. Attributed on the write - never a system session. */
  actorUserId: string
}

export interface UpdateChartAccountOptions {
  organizationId: string
  accountId: string
  code?: string
  name?: string
  accountType?: GlAccountTypeValue
  isActive?: boolean
  actorUserId: string
}

export interface RemoveChartAccountOptions {
  organizationId: string
  accountId: string
  actorUserId: string
}

/**
 * Add one account to the org's chart.
 *
 * All three of `code`, `name` and `accountType` are required - the field
 * registry declares them so and `assertRequiredFieldsPresent` enforces it. There
 * is no default for `accountType` and this module invents none: a statement
 * classification is what every role compatibility check is made against, and
 * guessing one would defeat the only reason the type is read.
 *
 * @returns the account exactly as `listChartAccounts` would render it.
 */
export async function createChartAccount(
  db: Database,
  options: CreateChartAccountOptions
): Promise<Result<ChartAccountRow, Error>> {
  const { organizationId, actorUserId } = options

  try {
    const code = options.code.trim()
    const name = options.name.trim()
    if (!code) throw new BadRequestError('An account needs a code.', { organizationId })
    if (!name) throw new BadRequestError('An account needs a name.', { organizationId })

    const { fields, defId } = await loadChartTarget(organizationId)

    const handler = crudHandler(db, organizationId, actorUserId)
    const created = await namingTheCode(code, () =>
      handler.create(defId, {
        gl_account_code: code,
        gl_account_name: name,
        gl_account_type: options.accountType,
        gl_account_is_active: options.isActive ?? true,
      } satisfies AccountValues)
    )

    return ok(await readBack(db, organizationId, created.instance.id, fields))
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to create a chart account', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * Change one account. Only the keys present are written.
 *
 * Two of the four fields are guarded, and both guards are about a role that
 * still posts here - see the file header.
 */
export async function updateChartAccount(
  db: Database,
  options: UpdateChartAccountOptions
): Promise<Result<ChartAccountRow, Error>> {
  const { organizationId, accountId, actorUserId } = options

  try {
    const { fields, defId } = await loadChartTarget(organizationId)
    const account = await requireAccount(db, organizationId, accountId, fields)

    const values: AccountValues = {}

    if (options.code !== undefined) {
      const code = options.code.trim()
      if (!code) throw new BadRequestError('An account needs a code.', { organizationId })
      values.gl_account_code = code
    }

    if (options.name !== undefined) {
      const name = options.name.trim()
      if (!name) throw new BadRequestError('An account needs a name.', { organizationId })
      values.gl_account_name = name
    }

    // ── I1: a type change may not break a role that posts here ──────────────
    //
    // 🛑 The guard the whole module exists for. `mapRole` refuses to point a
    // role at an incompatible account; without this, the same illegal pair is
    // reachable by mapping first and retyping second, and the resulting entry
    // BALANCES.
    if (options.accountType !== undefined && options.accountType !== account.accountType) {
      const live = await liveRolesFor(db, organizationId, accountId)
      for (const { role } of live) {
        const expected = ROLE_ACCOUNT_TYPES[role]
        if (expected !== options.accountType) {
          throw new UnprocessableEntityError(
            `Cannot make ${account.code} ${account.name} a ${options.accountType} account: '${role}' (${ACCOUNT_ROLE_LABELS[role]}) posts here and must be mapped to a ${expected} account. Repoint the role first, or mark it unused.`,
            { organizationId, accountId, role }
          )
        }
      }
      values.gl_account_type = options.accountType
    }

    // ── I2: deactivating an account a role still posts to ───────────────────
    //
    // `resolveRoles` refuses a mapped-inactive account at POST time, naming the
    // role. Refusing here turns a refused close next month into a refused click
    // now, which is the same trade `mapRole` makes.
    if (options.isActive !== undefined && options.isActive !== account.isActive) {
      if (options.isActive === false) {
        await assertNoLiveRole(
          db,
          organizationId,
          accountId,
          account,
          'deactivate',
          'Reactivating it later is a click; a refused close is not.'
        )
      }
      values.gl_account_is_active = options.isActive
    }

    if (Object.keys(values).length > 0) {
      const handler = crudHandler(db, organizationId, actorUserId)
      await namingTheCode(values.gl_account_code ?? account.code, () =>
        handler.update(toRecordId(defId, accountId), values)
      )
    }

    return ok(await readBack(db, organizationId, accountId, fields))
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to update a chart account', { error, organizationId, accountId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * Take one account out of the chart.
 *
 * 🛑 **This ARCHIVES. `handler.delete` appears nowhere in this module**, and
 * three independent reasons say so - any one of them sufficient:
 *
 *  1. Every reader already excludes archived rows **in the query**
 *     (`listChartAccounts`, `loadChartAccountsById`, `resolveRoles`). Archiving
 *     IS removal as far as the chart, the role picker and the resolver are
 *     concerned.
 *  2. `seedDefaultChartOfAccounts` reads existing codes INCLUDING archived rows,
 *     deliberately, so a re-seed does not resurrect what somebody removed:
 *     *"Someone who archived an account did not ask for it back."* A hard delete
 *     forfeits that - the next migration re-run puts the account straight back.
 *  3. A hard delete cascades away any `RecordIdentity` on the row, which is the
 *     connected provider's own account id (`P2`). `scripts/reset-gl-chart.ts`
 *     refuses to do that even in a dev wipe.
 *
 * Posted history is unaffected either way: `GlPostingLine` snapshots the code
 * and the name and has no foreign key to the instance.
 */
export async function removeChartAccount(
  db: Database,
  options: RemoveChartAccountOptions
): Promise<Result<{ id: string }, Error>> {
  const { organizationId, accountId, actorUserId } = options

  try {
    const { fields, defId } = await loadChartTarget(organizationId)
    const account = await requireAccount(db, organizationId, accountId, fields)

    // ── I3: removing an account a role still posts to ───────────────────────
    await assertNoLiveRole(
      db,
      organizationId,
      accountId,
      account,
      'remove',
      'A role pointing at a removed account fails the close closed, naming the role.'
    )

    const handler = crudHandler(db, organizationId, actorUserId)
    await handler.archive(toRecordId(defId, accountId))

    return ok({ id: accountId })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to remove a chart account', { error, organizationId, accountId })
    return err(new AuxxError('Internal error'))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The handler every write in this module goes through.
 *
 * 🛑 **`capabilities: undefined` and NOT `requestPath: true`**, which the
 * handler reads as "internal caller, no enforcement". That is correct here and
 * is not an oversight: the router has already asserted `ledgerPost`, and
 * re-asserting the generic RECORDS capability underneath it would hand the chart
 * to anyone with records-Full and ledger-None - the authorization inversion this
 * whole surface was built to avoid.
 *
 * The session is the default interactive one built from `actorUserId`. **Not**
 * `seedSession` / `quietSession`: a person renaming an account is exactly the
 * write that should be attributable, and the quiet lane also suppresses the
 * events a rename should emit.
 *
 * Going through the handler at all (rather than writing `FieldValue` by hand) is
 * what buys the uniqueness gate on `code`, `assertRequiredFieldsPresent`, and the
 * `SINGLE_SELECT` -> `optionId` write for `accountType` that the decode reads
 * back out of `optionId`.
 */
function crudHandler(db: Database, organizationId: string, actorUserId: string) {
  return new UnifiedCrudHandler(organizationId, actorUserId, db, undefined)
}

/**
 * Re-message a unique-code collision so it says which code collided.
 *
 * `validateUniqueFields` throws `"Code must be unique: value already exists"`,
 * which is true and useless - and only the MESSAGE crosses tRPC, since the
 * error serialises as a plain 409. `code` is the only unique field on
 * `gl_account`, so any conflict from a chart write is that one, and the sentence
 * a person needs is the whole of "4000 is already in use".
 */
async function namingTheCode<T>(code: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (error instanceof UniqueValueConflictError) {
      throw new UniqueValueConflictError({
        message: `${code} is already in use by another account in this chart.`,
        conflictingValue: code,
        fieldId: error.fieldId,
        existingEntityId: error.existingEntityId,
      })
    }
    throw error
  }
}

/** The four field ids and the `gl_account` definition, resolved together. */
async function loadChartTarget(
  organizationId: string
): Promise<{ fields: ChartAccountFields; defId: string }> {
  const fields = await loadChartAccountFields(organizationId, NOT_PROVISIONED)
  const defId = fields.code.entityDefinitionId
  if (!defId) {
    throw new UnprocessableEntityError(
      'The chart of accounts is not provisioned for this organization - gl_account_code is not attached to an entity definition. Run the entity migrations.',
      { organizationId }
    )
  }
  return { fields, defId }
}

/**
 * The account as it stands, or `NotFoundError`.
 *
 * Archived rows are excluded by {@link loadLiveAccount}'s query, so "archived"
 * and "does not exist" produce one answer - the same collapse every other reader
 * of this chart makes.
 */
async function requireAccount(
  db: Database,
  organizationId: string,
  accountId: string,
  fields: ChartAccountFields
): Promise<ChartAccountRow> {
  const account = await loadLiveAccount(db, organizationId, accountId, fields)
  if (!account) {
    throw new NotFoundError(
      `Account ${accountId} does not exist in this organization, or has been removed.`,
      { organizationId, accountId }
    )
  }
  return account
}

/**
 * Re-read the account after a write, and refuse if it came back undecodable.
 *
 * ⚠️ **This is the §2.2 guard, not a convenience.** `UnifiedCrudHandler` resolves
 * fields through the org cache and SILENTLY DROPS a value whose field it cannot
 * resolve - the failure that once wrote 784 accounts across 28 orgs with the one
 * field that mattered missing, and logged success. A dropped `gl_account_type`
 * produces an account the decode classifies as malformed, which means it vanishes
 * from the very list it was just created in. `loadChartAccountFields` above makes
 * that structurally unlikely; this makes it impossible to go unnoticed.
 */
async function readBack(
  db: Database,
  organizationId: string,
  accountId: string,
  fields: ChartAccountFields
): Promise<ChartAccountRow> {
  const account = await loadLiveAccount(db, organizationId, accountId, fields)
  if (!account) {
    throw new AuxxError(
      `The account was written but could not be read back with a code and a type (${accountId}). The write may have dropped a field value; nothing further has been changed.`,
      { organizationId, accountId }
    )
  }
  return account
}

/** One live (non-archived) account, decoded, or undefined. */
async function loadLiveAccount(
  db: Database,
  organizationId: string,
  accountId: string,
  fields: ChartAccountFields
): Promise<ChartAccountRow | undefined> {
  const live = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.id, accountId),
        // Archived is absent, exactly as every other reader of this chart has it.
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)

  if (live.length === 0) return undefined

  const read = await readChartAccountValues(db, organizationId, [accountId], fields)
  return read.accounts.get(accountId)
}

/**
 * The roles that still post to this account.
 *
 * ⚠️ "Still posts" means a `GlRoleAssignment` row that is **not**
 * `markedUnused`. That is the same exemption `listRoleMap`'s precedence table
 * derives as the `unused` state, and it is the only state that exempts: a role
 * the org has explicitly said it does not use is not a reason to refuse
 * anything. A direct one-account query rather than `listRoleMap` because that
 * one returns all thirteen roles and re-reads the chart to do it, and this needs
 * neither.
 */
async function liveRolesFor(
  db: Database,
  organizationId: string,
  accountId: string
): Promise<LiveRole[]> {
  const rows = await db
    .select({
      role: schema.GlRoleAssignment.role,
      glAccountId: schema.GlRoleAssignment.glAccountId,
    })
    .from(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        eq(schema.GlRoleAssignment.glAccountId, accountId),
        eq(schema.GlRoleAssignment.markedUnused, false)
      )
    )

  return rows
    .filter(
      (row): row is LiveRole =>
        (ROLE_ACCOUNT_TYPES as Record<string, string>)[row.role] !== undefined
    )
    .map((row) => ({ role: row.role as AccountRole, glAccountId: row.glAccountId }))
}

/**
 * Refuse `verb` while any role still posts to this account, naming the first.
 *
 * The message names the role, its label and what to do next, because that is the
 * standard the role map's refusals already set - "Could not save" throws away the
 * only sentence that says what to do.
 */
async function assertNoLiveRole(
  db: Database,
  organizationId: string,
  accountId: string,
  account: ChartAccountRow,
  verb: 'deactivate' | 'remove',
  consequence: string
): Promise<void> {
  const live = await liveRolesFor(db, organizationId, accountId)
  if (live.length === 0) return

  const named = live.map(({ role }) => `'${role}' (${ACCOUNT_ROLE_LABELS[role]})`).join(', ')
  throw new UnprocessableEntityError(
    `Cannot ${verb} ${account.code} ${account.name}: ${named} ${live.length === 1 ? 'posts' : 'post'} here. Repoint ${live.length === 1 ? 'the role' : 'those roles'} on the Roles tab first, or mark ${live.length === 1 ? 'it' : 'them'} unused. ${consequence}`,
    { organizationId, accountId, roles: live.map((row) => row.role).join(',') }
  )
}
