// packages/lib/src/accounting/ledger/roles/resolve-roles.ts

/**
 * The single door from a builder's posting ROLE to one org's own account
 * (decision `G8`, wired to decision `G19`'s `GlRoleAssignment` table).
 *
 * ```
 *   ACCOUNT_ROLES          the builder emits 'grni'
 *         │
 *         ▼
 *   GlRoleAssignment       THIS org maps grni -> some gl_account instance
 *         │
 *         ▼
 *   gl_account             that account's code, name, type, active flag
 *         │
 *         ▼
 *   ResolvedPostingLine    what a gl_posting_line stores, and what an adapter sees
 * ```
 *
 * ## Two things this file is, that are easy to get wrong
 *
 * **It is a BATCH.** `resolveRoles` takes the whole set of roles an entry
 * names and answers once. A month-end entry touching six roles on an org that
 * has mapped none of them must fail ONCE, naming all six, not six times naming
 * one - a bookkeeper fixing a close needs the list, not a treasure hunt. The
 * `G19` setup wizard needs exactly the same batch answer.
 *
 * **It fails CLOSED, on five distinct conditions, with five distinct messages.**
 * Collapsing them into "role not mapped" would be the cheap version and it would
 * be wrong: "you never mapped this" and "you marked this unused and the books
 * disagree" and "the account you mapped it to was archived" call for three
 * different actions by three different people.
 *
 * 🛑 **There is no default account and no "take the first".** That is the one
 * behaviour here that would put money in an arbitrary account: the entry would
 * still balance, so nothing downstream could detect it, and it would surface at
 * a close as a number nobody can reconstruct. The unique index on
 * `(organizationId, role)` makes `>1 match` unreachable; §"the impossible case"
 * below asserts it anyway.
 *
 * ## What is cached
 *
 * The accounts come from the `chartAccounts` org-cache key, invalidated by the
 * four `chart-write.ts` writers (plans/accounting/tasks/done/84-the-chart-in-the-org-cache.md).
 * The ASSIGNMENTS are not cached: `GlRoleAssignment` writes have no event yet, and
 * `role-assignments.ts`'s `readRoleAssignments` is where that key would go (§10.4).
 *
 * No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, type AuxxErrorDetails, UnprocessableEntityError } from '../../../errors'
import { findSystemRecordIdsByValue } from '../../../resources/system-records'
import {
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  ROLE_ACCOUNT_TYPES,
  roleScopeAxis,
} from '../builders/entry'
import { accountLabel } from '../chart/account-label'
import { loadChartAccountFields, loadChartAccountsById } from '../chart/chart-accounts'
import { CHART_PACKS, type GlAccountTypeValue, packForRole } from '../chart/default-chart'
import type { GlPostingLineInput, RoleSourceScope } from '../types'
import { type RoleAssignmentRecord, readRoleAssignments } from './role-assignments'
import { readLiveSourceAccountIds, readManualSourceAccountId } from './source-scope'

// Declared in `types.ts` (client-safe) because a posting LINE carries one; the
// resolver is where it is consulted, so it is re-exported from here too.
export type { RoleSourceScope } from '../types'

const logger = createScopedLogger('postings:resolve-roles')

/**
 * What an unprovisioned chart refuses a POSTING with.
 *
 * `role-map.ts` checks the same fact through the same door and says something
 * else, and that is deliberate: this sentence is read by whoever is trying to
 * post, the other by whoever is setting the chart up. `chart-accounts.ts` shares
 * the check and takes the message rather than picking one for both.
 */
const NOT_PROVISIONED =
  'The chart of accounts is not provisioned for this organization - gl_account_code / gl_account_type are missing. Run the entity migrations before posting.'

/** Key for the store-scoped lookup. A NUL byte cannot appear in either half. */
const scopedKey = (role: string, sourceAccountId: string) => `${role}\u0000${sourceAccountId}`

/**
 * Key for the rail-scoped lookup - role, rail AND currency, so a currencied row
 * and its rail's no-currency row are two slots, never one (58 §5.1, mirrors
 * `GlRoleAssignment_org_role_rail_key`'s `coalesce(currency, '')`).
 */
const railKey = (role: string, paymentGatewayId: string, currency: string | null) =>
  `${role}\u0000${paymentGatewayId}\u0000${currency ?? ''}`

/** One role's account, as it stands right now. Snapshot it onto the line; do not re-read. */
export interface ResolvedAccount {
  /** The `gl_account` `EntityInstance` id. `RecordIdentity` hangs the provider's id here (`P2`). */
  glAccountId: string
  /**
   * The account CODE - `'1310'`. What a `gl_posting_line` stores (`P2`).
   * Null when the account carries no code (task 15 §5) - a snapshot of
   * nothing is null, exactly as `accountName` already is.
   */
  code: string | null
  /** The account's name as it stands NOW. Snapshot it; renaming must not restate the ledger. */
  name: string
  accountType: GlAccountTypeValue
  /** Always `true` on a successful resolution - an inactive account is a refusal. */
  isActive: boolean
}

/**
 * Resolve every role in one call, or refuse naming all of them.
 *
 * Duplicate roles in `roles` are collapsed; the returned map is keyed by role.
 * An empty input resolves to an empty map rather than an error - an entry with
 * no lines is `buildEntry`'s refusal to make, not this function's.
 *
 * Fails closed on all five `G19` conditions, each with its own message:
 *
 * | Condition | What the reader has to do about it |
 * | --- | --- |
 * | no assignment row | map the role - nobody ever has |
 * | `markedUnused` | somebody said "we don't use this" and a builder emitted it anyway |
 * | account missing or archived | the chart moved under the mapping; repoint it |
 * | `isActive = false` | reactivate the account, or repoint the role |
 * | `accountType` incompatible | the mapping is to the wrong KIND of account |
 *
 * ## The scope chain (task 47 §5, rail axis and currency added by task 58 §5.1)
 *
 * ```
 * axis 'store', scope.store set    ->  (role, that id)         ->  (role, null)
 * axis 'store', scope.store null   ->  (role, manual id)       ->  (role, null)
 * axis 'rail',  scope.rail set     ->  (role, rail, currency)  ->  (role, rail, null)  ->  (role, null)
 * ```
 *
 * The five refusals above apply unchanged to whichever row wins - except
 * `bank` (`ROLES_WITHOUT_DEFAULT`), whose `(role, null)` cannot exist
 * (`setRoleAssignment` refuses to write an unscoped `bank` row): a miss on the
 * rail leaves it unresolved rather than reaching a fallback that is illegal to
 * begin with, and it fails closed with its own sentence below, same as any
 * other unmapped role.
 *
 * 🛑 **A miss falls back, it does not fail** (except `bank`, above). Connecting
 * a second store must never stop the books, so an unmapped source posts to the
 * org default and is surfaced by the settings screen rather than by a refusal
 * (decision D6). The same is true of a source ARCHIVED since somebody mapped
 * it: the assignment row survives the archive and must not be used (§12.5).
 *
 * ⚠️ An org with no scoped rows runs the query it ran before this brief and
 * takes the same decisions. That is the acceptance test for the whole brief.
 */
export async function resolveRoles(
  db: Database | Transaction,
  organizationId: string,
  roles: string[],
  scope?: RoleSourceScope
): Promise<Result<Map<string, ResolvedAccount>, Error>> {
  const wanted = [...new Set(roles)]
  if (wanted.length === 0) return ok(new Map())

  try {
    const assignments = (await readRoleAssignments(db, organizationId)).filter((row) =>
      wanted.includes(row.role)
    )

    // ── The impossible case, asserted anyway ──────────────────────────────
    // Three partial unique indexes on this table - the org default (WHERE
    // sourceAccountId AND paymentGatewayId are both NULL), the store override
    // (WHERE sourceAccountId IS NOT NULL) and the rail override (WHERE
    // paymentGatewayId IS NOT NULL, keyed on role + rail + coalesce(currency,
    // '')) - make every collision below unreachable. Asserted anyway because
    // the ONE failure this module must never have is picking arbitrarily
    // between two accounts, and an assertion is cheaper than the audit that
    // would follow. This is the fix for the live bug (58 §"START HERE"): a
    // rail row used to fall into the default bucket alongside the org default,
    // because both carry `sourceAccountId IS NULL`.
    const byRole = new Map<string, RoleAssignmentRecord>()
    const byStoreScope = new Map<string, RoleAssignmentRecord>()
    const byRailScope = new Map<string, RoleAssignmentRecord>()
    for (const row of assignments) {
      // `== null` catches BOTH null and undefined, deliberately - see
      // `role-assignments.ts` on why "absent" has to read as the org default.
      if (row.sourceAccountId != null) {
        const lookup = scopedKey(row.role, row.sourceAccountId)
        if (byStoreScope.has(lookup)) {
          throw new UnprocessableEntityError(
            `Organization ${organizationId} has more than one account mapped to role '${row.role}' ` +
              `for source ${row.sourceAccountId}. Refusing to choose. This should be impossible - ` +
              'GlRoleAssignment_org_role_source_key is a unique index.',
            { organizationId, role: row.role }
          )
        }
        byStoreScope.set(lookup, row)
        continue
      }
      if (row.paymentGatewayId != null) {
        const lookup = railKey(row.role, row.paymentGatewayId, row.currency)
        if (byRailScope.has(lookup)) {
          throw new UnprocessableEntityError(
            `Organization ${organizationId} has more than one account mapped to role '${row.role}' ` +
              `for rail ${row.paymentGatewayId}${row.currency ? ` in ${row.currency}` : ''}. Refusing ` +
              'to choose. This should be impossible - GlRoleAssignment_org_role_rail_key is a unique index.',
            { organizationId, role: row.role }
          )
        }
        byRailScope.set(lookup, row)
        continue
      }
      if (byRole.has(row.role)) {
        throw new UnprocessableEntityError(
          `Organization ${organizationId} has more than one account mapped to role '${row.role}'. ` +
            'Refusing to choose. This should be impossible - GlRoleAssignment_org_role_default_key ' +
            'is a unique index.',
          { organizationId, role: row.role }
        )
      }
      byRole.set(row.role, row)
    }

    // Which source each role reads, for the whole batch at once. Costs no query
    // at all on an org with no overrides for these roles, which is every org
    // until somebody writes one.
    const hasOverrides = byStoreScope.size > 0 || byRailScope.size > 0
    const scopeIdByRole = await resolveScopeIds(db, organizationId, wanted, scope, hasOverrides)

    /**
     * The row each role resolves through: its override when the source it came
     * from has one, the org default otherwise. A rail role walks the chain in
     * the doc comment above - currency, then no-currency, then the org
     * default (never reached by `bank`, which has none).
     */
    const chosen = new Map<string, RoleAssignmentRecord>()
    for (const role of wanted) {
      const scopeId = scopeIdByRole.get(role)
      if (roleScopeAxis(role) === 'rail') {
        const withCurrency =
          scopeId && scope?.currency
            ? byRailScope.get(railKey(role, scopeId, scope.currency))
            : undefined
        const withoutCurrency = scopeId ? byRailScope.get(railKey(role, scopeId, null)) : undefined
        const assignment = withCurrency ?? withoutCurrency ?? byRole.get(role)
        if (assignment) chosen.set(role, assignment)
        continue
      }
      const override =
        scopeId === undefined ? undefined : byStoreScope.get(scopedKey(role, scopeId))
      const assignment = override ?? byRole.get(role)
      if (assignment) chosen.set(role, assignment)
    }

    const accountIds = [...new Set([...chosen.values()].map((row) => row.glAccountId))]
    const accounts = await loadAccounts(db, organizationId, accountIds)

    const resolved = new Map<string, ResolvedAccount>()
    const problems: string[] = []
    // ⚠️ Parallel to `problems`, index for index, and it MUST stay that way:
    // `describeUnmappedRoles` pairs them to render one actionable row per role
    // and refuses to render any row at all if the two arrays disagree in
    // length. Two arrays rather than one array of objects because
    // `AuxxErrorDetails` values may only be `string | string[]`.
    const unresolvedRoles: string[] = []

    for (const role of wanted) {
      const assignment = chosen.get(role)
      /** Record one role's refusal, keeping the two arrays in step. */
      const refuse = (reason: string) => {
        problems.push(reason)
        unresolvedRoles.push(role)
      }

      if (!assignment) {
        // A DECLARED role gets the rich sentence naming its label and the pack
        // that would provision it (16 §3.2). An invented role (caught properly
        // below as "not a declared posting role") has neither, so it falls back
        // to the plain sentence rather than indexing `CHART_PACKS` with nothing.
        // A role in `ROLES_WITHOUT_DEFAULT` (`bank`, 58 §3 rule 3) has a label
        // but no pack - there is nothing to seed - so it gets its own sentence
        // rather than a third `CHART_PACKS` index with nothing.
        const label = ACCOUNT_ROLE_LABELS[role as AccountRole]
        const pack = label ? packForRole(role as AccountRole) : null
        refuse(
          pack
            ? `'${role}' (${label}) is not mapped to any account. Add the ${CHART_PACKS[pack].label} accounts under Accounting > Settings > Accounts > Roles, or map it to an account of your own there.`
            : label
              ? `'${role}' (${label}) has no organization-wide default and is not mapped for this scope. Map it under Accounting > Settings > Accounts > Roles.`
              : `'${role}' is not mapped to any account. Map it in the chart of accounts before posting.`
        )
        continue
      }

      if (assignment.markedUnused) {
        refuse(
          `'${role}' is marked as unused by this organization, but a posting was built that uses it. ` +
            'Either map it to an account or find out why the entry names it.'
        )
        continue
      }

      const account = accounts.get(assignment.glAccountId)
      if (!account) {
        refuse(
          `'${role}' is mapped to account ${assignment.glAccountId}, which no longer exists or has been archived. Repoint the role.`
        )
        continue
      }

      if (!account.isActive) {
        refuse(
          `'${role}' is mapped to ${accountLabel(account)}, which is not active. Reactivate the account or repoint the role.`
        )
        continue
      }

      const expectedType = ROLE_ACCOUNT_TYPES[role as AccountRole]
      // An UNDECLARED role reaching here means the caller invented one. That is
      // a closed vocabulary violation, not a mapping problem, so it gets its own
      // sentence rather than being folded into the type mismatch below.
      if (!expectedType) {
        refuse(
          `'${role}' is not a declared posting role. The role vocabulary is closed - see ACCOUNT_ROLES.`
        )
        continue
      }

      if (account.accountType !== expectedType) {
        refuse(
          `'${role}' must be mapped to a ${expectedType} account, but ${accountLabel(account)} is a ${account.accountType} account.`
        )
        continue
      }

      resolved.set(role, account)
    }

    if (problems.length > 0) {
      return err(
        new UnprocessableEntityError(
          `Cannot post: ${problems.length} posting role(s) do not resolve to a usable account. ${problems.join(' ')}`,
          // 🛑 `unresolvedRoles` / `unresolvedReasons` are the SAME refusal the
          // message carries, split so a screen can offer one remedy per role
          // instead of one button under a paragraph. The message is unchanged
          // and stays the only thing a log or a non-console caller has to read.
          {
            organizationId,
            roles: wanted.join(','),
            unresolvedRoles,
            unresolvedReasons: problems,
          }
        )
      )
    }

    return ok(resolved)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to resolve posting roles', { error, organizationId, roles: wanted })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * The `FinancialSourceAccount` (store axis) or `payment_gateway` (rail axis)
 * each wanted role resolves through, or nothing.
 *
 * A role is absent from the answer whenever it is not scopable, the caller
 * supplied no scope, the caller does not know the axis that role reads, or the
 * id it names is not live in this org - and absent means "use the org
 * default", which is what every role did before task 47 (store) and before
 * task 58 (rail); `resolveRoles` folds `bank`'s exception to that in.
 *
 * ⚠️ Runs inside {@link resolveRoles}' existing batch rather than as a separate
 * round trip per line, and does nothing at all unless the org actually holds a
 * scoped row for one of the roles being resolved (`hasOverrides`). That is what
 * keeps the no-op guarantee literal: an org that maps nothing issues exactly the
 * query it issued before. Do NOT add a cache key here - `resolve-roles.ts`'s own
 * "Not cached" argument is unchanged by this brief; `role-assignments.ts` is
 * where a future one goes (§10.4).
 *
 * 🛑 The NULL-to-manual translation lives here and nowhere else. The sentinel
 * is a mapping key, never an effect value (§3.2).
 */
async function resolveScopeIds(
  db: Database | Transaction,
  organizationId: string,
  wanted: readonly string[],
  scope: RoleSourceScope | undefined,
  hasOverrides: boolean
): Promise<Map<string, string>> {
  const answer = new Map<string, string>()
  if (!scope || !hasOverrides) return answer

  const axes = new Map(wanted.map((role) => [role, roleScopeAxis(role)]))
  const wantsStore = [...axes.values()].includes('store')
  const wantsRail = [...axes.values()].includes('rail')
  if (!wantsStore && !wantsRail) return answer

  // The store id the caller named, checked for liveness. An archived source
  // falls back to the default rather than posting to the account somebody
  // chose for a store that is gone (§12.5).
  const storeId = wantsStore && typeof scope.store === 'string' ? scope.store : null
  const railId = wantsRail && typeof scope.rail === 'string' ? scope.rail : null
  const [storeLive, manualId, railLive] = await Promise.all([
    storeId
      ? readLiveSourceAccountIds(db, organizationId, [storeId])
      : Promise.resolve(new Set<string>()),
    // Only when a store-axis role is in play AND this record had no connected
    // source. `readManualSourceAccountId` already filters live and archived.
    wantsStore && scope.store === null
      ? readManualSourceAccountId(db, organizationId)
      : Promise.resolve(null),
    // A rail id names a `payment_gateway` EntityInstance, not a
    // `FinancialSourceAccount` - a different table from the store axis (task
    // 58), so `readLiveSourceAccountIds` cannot answer this one.
    railId ? readLiveGatewayIds(db, organizationId, [railId]) : Promise.resolve(new Set<string>()),
  ])

  for (const [role, axis] of axes) {
    if (axis === 'store') {
      // `undefined` is "this caller does not know"; `null` is "there was no
      // connected source". Only the second reaches the manual bucket.
      if (scope.store === undefined) continue
      const id = scope.store === null ? manualId : scope.store
      if (id && (id === manualId || storeLive.has(id))) answer.set(role, id)
      continue
    }
    if (axis === 'rail') {
      // No manual counterpart: a manual order has no rail, so a null here
      // reads exactly like an absent key (§4).
      if (railId && railLive.has(railId)) answer.set(role, railId)
    }
  }

  return answer
}

/**
 * Live `payment_gateway` `EntityInstance` ids among `ids` - the rail-axis
 * counterpart of `readLiveSourceAccountIds`, against `EntityInstance` rather
 * than `FinancialSourceAccount` (task 58 §5.1). No entity-def check, same call
 * `loadChartAccountsById` makes for a `gl_account` id: the only source of a
 * rail id is a `GlRoleAssignment.paymentGatewayId` FK or an effect built from
 * one, so an id from anywhere else is not a scope this module will ever see.
 */
async function readLiveGatewayIds(
  db: Database | Transaction,
  organizationId: string,
  ids: readonly string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, [...new Set(ids)]),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  return new Set(rows.map((row) => row.id))
}

/**
 * The named accounts, shaped as {@link ResolvedAccount}.
 *
 * A thin re-key of the shared chart read in `chart-accounts.ts` - `id` becomes
 * `glAccountId`, because a `gl_posting_line` names an ACCOUNT and a bare `id` on
 * a resolved line would not say which id it is. Everything below the re-key -
 * the four attributes, the org-cache field lookup, the archived-excluded
 * rule, the `optionId` read for the type, "missing code or type means
 * ABSENT, never defaulted", "missing active flag means active" - lives there, so
 * that the role map and this resolver cannot come to disagree about what one
 * account says.
 *
 * `malformed` is discarded rather than logged: a role pointing at an undecodable
 * account already produces a refusal naming that role, and the warning would be
 * the same fact a second time.
 */
async function loadAccounts(
  db: Database | Transaction,
  organizationId: string,
  accountIds: string[]
): Promise<Map<string, ResolvedAccount>> {
  const { accounts } = await loadChartAccountsById(db, organizationId, accountIds, NOT_PROVISIONED)

  const result = new Map<string, ResolvedAccount>()
  for (const [id, account] of accounts) {
    result.set(id, {
      glAccountId: id,
      code: account.code,
      name: account.name,
      accountType: account.accountType,
      isActive: account.isActive,
    })
  }
  return result
}

/**
 * Resolve every line of an entry - role lines AND code lines - in one batch.
 *
 * Returns one {@link ResolvedAccount} per input line, in the SAME order as the
 * input, so a caller can zip the two arrays without a key.
 *
 * ## The five refusals, applied to both shapes
 *
 * {@link resolveRoles} fails closed on five `G19` conditions. A CODE line is
 * held to the same five, because "the human typed it" is not evidence:
 *
 * | Condition | role line | code line |
 * | --- | --- | --- |
 * | no such thing | the role is unmapped | the chart holds no account with that code |
 * | withdrawn | the role is `markedUnused` | (n/a - a code names an account, not a mapping) |
 * | archived / missing | the mapped account is gone | the account with that code is archived |
 * | not active | `isActive = false` | `isActive = false` |
 * | ambiguous | >1 assignment row (impossible, asserted) | >1 live account carries the code |
 *
 * 🛑 **The type-compatibility refusal has no code-line counterpart, on purpose.**
 * A role means something (`grni` IS a liability), so a role pointed at a revenue
 * account is a mapping mistake. A code means only "this account", and the person
 * typing it is looking at the chart: `6300` is whatever type the org made it,
 * and there is no second declaration for it to disagree with. Inventing an
 * expected type for a code line would have to guess one from the direction or
 * from the posting type, and both guesses are wrong for ordinary entries (a
 * credit to an expense account is a legitimate correction).
 *
 * Every problem across both shapes is collected and reported in ONE
 * `UnprocessableEntityError` naming every offending row, for the reason the file
 * header gives: a bookkeeper fixing an entry needs the list, not a treasure hunt.
 * Rows are named by their 1-based position so the message lines up with the grid
 * the person is looking at.
 */
export async function resolveAccountLines(
  db: Database | Transaction,
  organizationId: string,
  lines: readonly GlPostingLineInput[],
  scope?: RoleSourceScope
): Promise<Result<ResolvedAccount[], Error>> {
  if (lines.length === 0) return ok([])

  try {
    const codes = [
      ...new Set(lines.map((line) => line.accountCode).filter((c): c is string => !!c)),
    ]
    const ids = [...new Set(lines.map((line) => line.glAccountId).filter((i): i is string => !!i))]

    const problems: string[] = []

    // ── Roles, bucketed by the SOURCE each line resolves through ─────────
    //
    // Precedence is `line.sourceScope ?? scope`, applied HERE and nowhere else
    // (task 47 §5). One entry can span two stores - the fulfillment group merges
    // a day's shipments - so two `revenue_product` lines with different scopes
    // must resolve to different accounts and stay two lines.
    //
    // ⚠️ One `resolveRoles` call PER DISTINCT SCOPE, not per line. An entry from
    // a single source is one call, exactly as before; a two-store group is two.
    // Each call keeps the batch property the resolver's header insists on - it
    // answers for its whole set at once and names every offending role.
    //
    // Only a line that RESOLVES through its role goes through the role door. A
    // reversal carries the original's `glAccountId` plus its role as a
    // snapshot; asking the role map about it would refuse a rail-scoped role
    // at org scope for a line that already names its account.
    const buckets = new Map<string, { scope?: RoleSourceScope; roles: Set<string> }>()
    for (const line of lines) {
      if (!line.accountRole || line.glAccountId || line.accountCode) continue
      const effective = line.sourceScope ?? scope
      const key = scopeBucketKey(effective)
      const bucket = buckets.get(key)
      if (bucket) bucket.roles.add(line.accountRole)
      else buckets.set(key, { scope: effective, roles: new Set([line.accountRole]) })
    }

    // Scope bucket key -> role -> account.
    const byScopeKey = new Map<string, Map<string, ResolvedAccount>>()
    // Forwarded verbatim from the role door so a line-level refusal can still
    // offer a remedy per ROLE. Only roles carry this: a bad code or a dead id
    // names a ROW, and the row is fixed on the entry rather than in the chart.
    let roleDetails: AuxxErrorDetails = {}
    for (const [key, bucket] of buckets) {
      const resolved = await resolveRoles(db, organizationId, [...bucket.roles], bucket.scope)
      if (resolved.isErr()) {
        problems.push(resolved.error.message)
        if (resolved.error instanceof AuxxError) {
          const { unresolvedRoles, unresolvedReasons } = resolved.error.details
          // ⚠️ The FIRST bucket's remedies, not the last one's. Two buckets can
          // name the same role - the remedy is the same sentence about the same
          // role map either way - so the screen renders one set rather than
          // flickering between two identical ones.
          if (unresolvedRoles && unresolvedReasons && !roleDetails.unresolvedRoles) {
            roleDetails = { unresolvedRoles, unresolvedReasons }
          }
        }
      } else byScopeKey.set(key, resolved.value)
    }
    /** How many of `problems` came from the role door. See the refusal below. */
    const roleRefusals = problems.length
    /** The account a ROLE line resolves to, through its own line's scope. */
    const roleAccount = (line: GlPostingLineInput): ResolvedAccount | undefined =>
      line.accountRole
        ? byScopeKey.get(scopeBucketKey(line.sourceScope ?? scope))?.get(line.accountRole)
        : undefined

    const byCode =
      codes.length > 0 ? await loadAccountsByCode(db, organizationId, codes) : new Map()

    // ID lines go through the same by-id door a role's assignment does, so an
    // id and the role that points at it cannot disagree about what the account
    // says. Archived reads as missing, exactly as it does for a code (task 15).
    const byId =
      ids.length > 0
        ? await loadAccounts(db, organizationId, ids)
        : new Map<string, ResolvedAccount>()

    for (const [index, line] of lines.entries()) {
      const row = index + 1
      if (line.glAccountId) {
        const account = byId.get(line.glAccountId)
        if (!account) {
          problems.push(
            `Row ${row}: this organization's chart has no active account with id '${line.glAccountId}'. ` +
              'It may have been archived or deleted since the line it reverses was posted.'
          )
          continue
        }
        if (!account.isActive) {
          problems.push(
            `Row ${row}: ${accountLabel(account)} is not active. Reactivate it before posting to it again.`
          )
        }
        continue
      }
      if (line.accountCode) {
        const found = byCode.get(line.accountCode)
        if (!found) {
          problems.push(
            `Row ${row}: this organization's chart has no active account with code '${line.accountCode}'. ` +
              'It may never have existed, or it may have been archived or deactivated.'
          )
          continue
        }
        if (found.length > 1) {
          problems.push(
            `Row ${row}: code '${line.accountCode}' is carried by ${found.length} accounts in this chart. ` +
              'Refusing to choose - give one of them a different code first.'
          )
          continue
        }
        const account = found[0]
        if (account && !account.isActive) {
          problems.push(
            `Row ${row}: ${accountLabel(account)} is not active. Reactivate it, or code the line to another account.`
          )
        }
        continue
      }
      // A line with neither shape is `buildEntry`'s refusal to make, not this
      // one's - but it must not silently resolve to nothing either.
      if (!line.accountRole) {
        problems.push(
          `Row ${row}: the line names neither an account role, an account code nor an account id.`
        )
      }
    }

    if (problems.length > 0) {
      return err(
        new UnprocessableEntityError(
          `Cannot post: ${problems.length} line(s) do not resolve to a usable account. ${problems.join(' ')}`,
          // 🛑 Only when the roles were the ONLY thing wrong. The role door
          // contributes one entry to `problems` per SCOPE BUCKET (each its own
          // joined message), so anything beyond that means a ROW failed too - a
          // dead id, an unknown code, a line naming neither. A screen that
          // rendered the role rows would then be hiding those sentences behind a
          // list that does not mention them.
          { organizationId, ...(problems.length === roleRefusals ? roleDetails : {}) }
        )
      )
    }

    const resolvedLines: ResolvedAccount[] = []
    for (const [index, line] of lines.entries()) {
      const account = line.glAccountId
        ? byId.get(line.glAccountId)
        : line.accountCode
          ? byCode.get(line.accountCode)?.[0]
          : roleAccount(line)
      if (!account) {
        // Unreachable: every line either resolved above or produced a problem.
        // Asserted because the alternative is a ledger line with no account.
        return err(
          new UnprocessableEntityError(
            `Row ${index + 1} resolved to nothing. Refusing to post a line with no account.`,
            { organizationId }
          )
        )
      }
      resolvedLines.push(account)
    }

    return ok(resolvedLines)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to resolve posting lines', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * A stable key for one {@link RoleSourceScope}, so lines that resolve through
 * the same source share a single {@link resolveRoles} call.
 *
 * ⚠️ `undefined`, `{}` and `{ store: undefined }` all key the same, because
 * they mean the same thing - "no axis is known, use the org default". `null` and
 * an id do not, because they do not.
 */
function scopeBucketKey(scope: RoleSourceScope | undefined): string {
  if (!scope) return '-'
  const part = (value: string | null | undefined) =>
    value === undefined ? '-' : value === null ? 'manual' : value
  return `${part(scope.store)}|${part(scope.rail)}|${scope.currency ?? '-'}`
}

/**
 * The accounts a set of ROLES currently points at, WITHOUT refusing.
 *
 * The counterpart to {@link resolveRoles} for a reader that is asking a
 * question rather than posting: "which account, if any, carries `inventory_wip`
 * in this org?". An unmapped, unused, archived or inactive role simply has no
 * entry, because the answer to that question is genuinely "none" and a refusal
 * would be wrong - the caller is not trying to put money anywhere.
 *
 * 🛑 The name is a holdover - it has always returned {@link ResolvedAccount}
 * rows, never bare codes - and `post-entry.ts`'s caller now keys its guard on
 * `glAccountId` rather than `code` (task 15 §5, a code is optional). Left
 * unrenamed here because `opening-trial-balance/reads.ts`, `reports/aging.ts`,
 * `reports/balance-sheet.ts` and `postings/index.ts` all import it by this
 * name and only some of those are this lane's files.
 *
 * The one caller today is the manual/opening inventory refusal in
 * `post-entry.ts`, which has to name the accounts a hand-keyed entry may not
 * touch. An org that has not mapped `inventory_wip` has nothing to protect,
 * and refusing every manual entry over it would be absurd.
 */
export async function loadRoleAccountCodes(
  db: Database | Transaction,
  organizationId: string,
  roles: readonly string[]
): Promise<Map<string, ResolvedAccount>> {
  const wanted = [...new Set(roles)]
  if (wanted.length === 0) return new Map()

  const rows = await readRoleAssignments(db, organizationId)
  // 🛑 The ORG DEFAULT only, and that now excludes a RAIL row too (task 58) -
  // a rail row also carries no `sourceAccountId`. This answer is compared
  // against account IDS by its caller, so a per-source or per-rail override
  // would attach an account to the guarded set the caller never asked about.
  // None of the roles it is called with is scopable today (§4), so this is a
  // statement of intent as much as a filter.
  const live = rows.filter(
    (row) =>
      wanted.includes(row.role) &&
      !row.markedUnused &&
      row.sourceAccountId == null &&
      row.paymentGatewayId == null
  )
  const accounts = await loadAccounts(
    db,
    organizationId,
    live.map((row) => row.glAccountId)
  )

  const result = new Map<string, ResolvedAccount>()
  for (const row of live) {
    const account = accounts.get(row.glAccountId)
    if (account) result.set(row.role, account)
  }
  return result
}

/**
 * Live accounts in this org's chart carrying any of the named CODES.
 *
 * Keyed by code and valued by an ARRAY rather than a single account, because
 * "two live accounts share one code" is the ambiguity refusal and collapsing it
 * to `.get(code)` here would silently pick one - the exact behaviour the role
 * resolver's "no default and no take-the-first" rule forbids one level up. The
 * uniqueness of `gl_account_code` is a registry capability, not a database
 * constraint, so this is reachable through the importer and through two
 * concurrent creates.
 *
 * Archived instances are excluded by `loadChartAccountsById`, which is why an
 * archived account reads exactly like one that never existed: from a coder's
 * point of view they are the same fact.
 *
 * A code line always names a non-empty code (`GlPostingLineInput`'s code
 * variant keeps `accountCode: string`), so an account with a null code (task
 * 15 §5) can never be what a code line is looking for and is skipped here
 * rather than bucketed under a key nothing will ever ask for.
 */
async function loadAccountsByCode(
  db: Database | Transaction,
  organizationId: string,
  codes: string[]
): Promise<Map<string, ResolvedAccount[]>> {
  const fields = await loadChartAccountFields(organizationId, NOT_PROVISIONED, db)

  const defId = fields.code.entityDefinitionId
  if (!defId) return new Map()
  const holders = await findSystemRecordIdsByValue(
    db,
    organizationId,
    { defId, fields: { gl_account_code: fields.code } },
    { attribute: 'gl_account_code', text: codes }
  )

  // Through the shared reader rather than a second decode, so this and the role
  // resolver cannot come to disagree about what one account says - and so the
  // archived-excluded-by-the-query rule is applied in exactly one place.
  const accounts = await loadAccounts(db, organizationId, [...holders.values()].flat())

  const byCode = new Map<string, ResolvedAccount[]>()
  for (const account of accounts.values()) {
    if (!account.code) continue
    const bucket = byCode.get(account.code)
    if (bucket) bucket.push(account)
    else byCode.set(account.code, [account])
  }
  return byCode
}
