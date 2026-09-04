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
import { loadChartAccountFields, loadChartAccountsById } from './chart-accounts'
import type { GlAccountTypeValue } from './default-chart'
import type { GlPostingLineInput } from './types'

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
  db: Database,
  organizationId: string,
  lines: readonly GlPostingLineInput[]
): Promise<Result<ResolvedAccount[], Error>> {
  if (lines.length === 0) return ok([])

  try {
    const roles = [
      ...new Set(lines.map((line) => line.accountRole).filter((r): r is string => !!r)),
    ]
    const codes = [
      ...new Set(lines.map((line) => line.accountCode).filter((c): c is string => !!c)),
    ]

    const problems: string[] = []

    // Roles go through the existing door unchanged, so the two shapes cannot
    // drift apart on what a role means. Its message already names every role.
    let byRole = new Map<string, ResolvedAccount>()
    if (roles.length > 0) {
      const resolved = await resolveRoles(db, organizationId, roles)
      if (resolved.isErr()) problems.push(resolved.error.message)
      else byRole = resolved.value
    }

    const byCode =
      codes.length > 0 ? await loadAccountsByCode(db, organizationId, codes) : new Map()

    for (const [index, line] of lines.entries()) {
      const row = index + 1
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
            `Row ${row}: ${account.code} ${account.name} is not active. Reactivate it, or code the line to another account.`
          )
        }
        continue
      }
      // A line with neither shape is `buildEntry`'s refusal to make, not this
      // one's - but it must not silently resolve to nothing either.
      if (!line.accountRole) {
        problems.push(`Row ${row}: the line names neither an account role nor an account code.`)
      }
    }

    if (problems.length > 0) {
      return err(
        new UnprocessableEntityError(
          `Cannot post: ${problems.length} line(s) do not resolve to a usable account. ${problems.join(' ')}`,
          { organizationId }
        )
      )
    }

    const resolvedLines: ResolvedAccount[] = []
    for (const [index, line] of lines.entries()) {
      const account = line.accountCode
        ? byCode.get(line.accountCode)?.[0]
        : byRole.get(line.accountRole as string)
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
 * The accounts a set of ROLES currently points at, WITHOUT refusing.
 *
 * The counterpart to {@link resolveRoles} for a reader that is asking a
 * question rather than posting: "which account, if any, carries `inventory_wip`
 * in this org?". An unmapped, unused, archived or inactive role simply has no
 * entry, because the answer to that question is genuinely "none" and a refusal
 * would be wrong - the caller is not trying to put money anywhere.
 *
 * The one caller today is the manual/opening inventory refusal in
 * `post-entry.ts`, which has to name the account codes a hand-keyed entry may
 * not touch. An org that has not mapped `inventory_wip` has nothing to protect,
 * and refusing every manual entry over it would be absurd.
 */
export async function loadRoleAccountCodes(
  db: Database,
  organizationId: string,
  roles: readonly string[]
): Promise<Map<string, ResolvedAccount>> {
  const wanted = [...new Set(roles)]
  if (wanted.length === 0) return new Map()

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

  // Filtered on BOTH the requested set and `markedUnused`, even though the
  // query already narrows the first: this function's answer is compared against
  // account CODES by its caller, so a stray role leaking in would attach an
  // unrelated account's code to the guarded set and refuse an innocent entry.
  const live = assignments.filter((row) => !row.markedUnused && wanted.includes(row.role))
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
 */
async function loadAccountsByCode(
  db: Database,
  organizationId: string,
  codes: string[]
): Promise<Map<string, ResolvedAccount[]>> {
  const fields = await loadChartAccountFields(organizationId, NOT_PROVISIONED)

  const rows = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, fields.code.id),
        inArray(schema.FieldValue.valueText, codes)
      )
    )

  // Through the shared reader rather than a second decode, so this and the role
  // resolver cannot come to disagree about what one account says - and so the
  // archived-excluded-by-the-query rule is applied in exactly one place.
  const accounts = await loadAccounts(
    db,
    organizationId,
    rows.map((row) => row.entityId)
  )

  const byCode = new Map<string, ResolvedAccount[]>()
  for (const account of accounts.values()) {
    const bucket = byCode.get(account.code)
    if (bucket) bucket.push(account)
    else byCode.set(account.code, [account])
  }
  return byCode
}
