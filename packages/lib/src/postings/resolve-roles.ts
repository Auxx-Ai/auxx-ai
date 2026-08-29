// packages/lib/src/postings/resolve-roles.ts

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
 * one — a bookkeeper fixing a close needs the list, not a treasure hunt. The
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
 * ## Not cached, deliberately — read this before adding a cache key
 *
 * The obvious move is an `OrgCacheDataMap` key. It was considered and rejected
 * for now, because the invalidation doors this would need do not exist:
 * `gl_account` is an `EntityInstance`, and there is no per-entity-type record
 * event in `INVALIDATION_GRAPH` — only `entity-def.*` and `custom-field.*`,
 * neither of which fires when a bookkeeper renames or archives an ACCOUNT. A
 * cached key wired to the doors that DO exist is correct for an hour and then
 * posts to the account somebody renamed, and it fails OPEN: the entry balances.
 *
 * The cost of not caching is two indexed reads on a path that runs at a close or
 * per posted event — not a hot request path. When the `G19` wizard lands and
 * gives assignment writes an explicit event of their own, cache it then, and
 * wire `gl_account` create/update/archive at the same time or not at all.
 *
 * No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, UnprocessableEntityError } from '../errors'
import { type AccountRole, ROLE_ACCOUNT_TYPES } from './build-entry'
import { loadChartAccountsById } from './chart-accounts'
import type { GlAccountTypeValue } from './default-chart'

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

/** One role's account, as it stands right now. Snapshot it onto the line; do not re-read. */
export interface ResolvedAccount {
  /** The `gl_account` `EntityInstance` id. `RecordIdentity` hangs the provider's id here (`P2`). */
  glAccountId: string
  /** The account CODE — `'1310'`. What a `gl_posting_line` stores (`P2`). */
  code: string
  /** The account's name as it stands NOW. Snapshot it; renaming must not restate the ledger. */
  name: string
  accountType: GlAccountTypeValue
  /** Always `true` on a successful resolution — an inactive account is a refusal. */
  isActive: boolean
}

/**
 * Resolve every role in one call, or refuse naming all of them.
 *
 * Duplicate roles in `roles` are collapsed; the returned map is keyed by role.
 * An empty input resolves to an empty map rather than an error — an entry with
 * no lines is `buildEntry`'s refusal to make, not this function's.
 *
 * Fails closed on all five `G19` conditions, each with its own message:
 *
 * | Condition | What the reader has to do about it |
 * | --- | --- |
 * | no assignment row | map the role — nobody ever has |
 * | `markedUnused` | somebody said "we don't use this" and a builder emitted it anyway |
 * | account missing or archived | the chart moved under the mapping; repoint it |
 * | `isActive = false` | reactivate the account, or repoint the role |
 * | `accountType` incompatible | the mapping is to the wrong KIND of account |
 */
export async function resolveRoles(
  db: Database,
  organizationId: string,
  roles: string[]
): Promise<Result<Map<string, ResolvedAccount>, Error>> {
  const wanted = [...new Set(roles)]
  if (wanted.length === 0) return ok(new Map())

  try {
    const assignments = await db
      .select({
        role: schema.GlRoleAssignment.role,
        glAccountId: schema.GlRoleAssignment.glAccountId,
        markedUnused: schema.GlRoleAssignment.markedUnused,
      })
      .from(schema.GlRoleAssignment)
      .where(
        and(
          eq(schema.GlRoleAssignment.organizationId, organizationId),
          inArray(schema.GlRoleAssignment.role, wanted)
        )
      )

    // ── The impossible case, asserted anyway ──────────────────────────────
    // `GlRoleAssignment_org_role_key` is a Postgres unique index on
    // (organizationId, role), so this cannot fire. It is here because the ONE
    // failure this module must never have is picking arbitrarily between two
    // accounts, and an assertion is cheaper than the audit that would follow.
    const byRole = new Map<string, (typeof assignments)[number]>()
    for (const row of assignments) {
      if (byRole.has(row.role)) {
        throw new UnprocessableEntityError(
          `Organization ${organizationId} has more than one account mapped to role '${row.role}'. ` +
            'Refusing to choose. This should be impossible — GlRoleAssignment_org_role_key is a unique index.',
          { organizationId, role: row.role }
        )
      }
      byRole.set(row.role, row)
    }

    const accountIds = [...new Set(assignments.map((row) => row.glAccountId))]
    const accounts = await loadAccounts(db, organizationId, accountIds)

    const resolved = new Map<string, ResolvedAccount>()
    const problems: string[] = []

    for (const role of wanted) {
      const assignment = byRole.get(role)

      if (!assignment) {
        problems.push(
          `'${role}' is not mapped to any account. Map it in the chart of accounts before posting.`
        )
        continue
      }

      if (assignment.markedUnused) {
        problems.push(
          `'${role}' is marked as unused by this organization, but a posting was built that uses it. ` +
            'Either map it to an account or find out why the entry names it.'
        )
        continue
      }

      const account = accounts.get(assignment.glAccountId)
      if (!account) {
        problems.push(
          `'${role}' is mapped to account ${assignment.glAccountId}, which no longer exists or has been archived. Repoint the role.`
        )
        continue
      }

      if (!account.isActive) {
        problems.push(
          `'${role}' is mapped to ${account.code} ${account.name}, which is not active. Reactivate the account or repoint the role.`
        )
        continue
      }

      const expectedType = ROLE_ACCOUNT_TYPES[role as AccountRole]
      // An UNDECLARED role reaching here means the caller invented one. That is
      // a closed vocabulary violation, not a mapping problem, so it gets its own
      // sentence rather than being folded into the type mismatch below.
      if (!expectedType) {
        problems.push(
          `'${role}' is not a declared posting role. The role vocabulary is closed — see ACCOUNT_ROLES.`
        )
        continue
      }

      if (account.accountType !== expectedType) {
        problems.push(
          `'${role}' must be mapped to a ${expectedType} account, but ${account.code} ${account.name} is a ${account.accountType} account.`
        )
        continue
      }

      resolved.set(role, account)
    }

    if (problems.length > 0) {
      return err(
        new UnprocessableEntityError(
          `Cannot post: ${problems.length} posting role(s) do not resolve to a usable account. ${problems.join(' ')}`,
          { organizationId, roles: wanted.join(',') }
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
 * The named accounts, shaped as {@link ResolvedAccount}.
 *
 * A thin re-key of the shared chart read in `chart-accounts.ts` - `id` becomes
 * `glAccountId`, because a `gl_posting_line` names an ACCOUNT and a bare `id` on
 * a resolved line would not say which id it is. Everything below the re-key -
 * the four attributes, the org-cache field lookup, the archived-excluded-by-the-
 * query rule, the `optionId` read for the type, "missing code or type means
 * ABSENT, never defaulted", "missing active flag means active" - lives there, so
 * that the role map and this resolver cannot come to disagree about what one
 * account says.
 *
 * `malformed` is discarded rather than logged: a role pointing at an undecodable
 * account already produces a refusal naming that role, and the warning would be
 * the same fact a second time.
 */
async function loadAccounts(
  db: Database,
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
