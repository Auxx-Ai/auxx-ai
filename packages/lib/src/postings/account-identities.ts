// packages/lib/src/postings/account-identities.ts

/**
 * `G19`'s account map, read and written: which account in the CONNECTED
 * accounting system each of the org's own accounts corresponds to.
 *
 * `role-map.ts` answers the hop above this one - which of MY accounts fulfils
 * each posting role. Together they are the whole chain:
 *
 *     posting role  ->  auxx gl_account  ->  provider account
 *      (role-map.ts)       (this file)
 *
 * ## Nothing here knows what QuickBooks is
 *
 * Every provider-shaped fact arrives through the `AccountingProvider` interface
 * - the chart through `listProviderAccounts`, the mapping through
 * `listAccountMappings`, the write through `setAccountMapping`. That is decision
 * `P1` applied to the setup surface rather than to the poster: the mapping
 * screen has to work the same way for the second accounting system as for the
 * first, and a module that imported the QuickBooks adapter to read a chart would
 * quietly make QuickBooks the only one that could ever be mapped.
 *
 * ## The list is a CHECKLIST
 *
 * {@link listAccountIdentities} returns a row for EVERY live account in the
 * chart, mapped or not - `role-map.ts`'s rule, for `role-map.ts`'s reason. The
 * question this screen exists to answer is "what is still unmapped", and a list
 * of the rows that happen to exist could never show it.
 *
 * No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, UnprocessableEntityError } from '../errors'
import { resolveAccountingProvider } from './provider'
import { listChartAccounts } from './role-map'
import {
  classificationArticle,
  isMappableTo,
  suggestAccountIdentities,
} from './suggest-account-identities'
import type { AccountIdentityRow, ChartAccountRow, ProviderAccount } from './types'

const logger = createScopedLogger('postings:account-identities')

/** The chart, the provider's chart, and every row's mapping state. */
export interface AccountIdentityMap {
  /** The connected provider's id, or `'none'`. */
  providerId: string
  /** One row per live `gl_account`, mapped or not. */
  rows: AccountIdentityRow[]
  /** The provider's own chart, for a picker. Empty when nothing is connected. */
  providerAccounts: ProviderAccount[]
  /**
   * Rows that are mapped but whose mapping no longer validates - the target was
   * deleted, deactivated, or its classification no longer agrees.
   *
   * Surfaced separately because `G19` requires a close to refuse on exactly
   * these, and a screen has to be able to lead with them rather than leave them
   * to be found by scrolling.
   */
  broken: string[]
}

/**
 * Every account in the org's chart, its provider mapping, and what the matcher
 * would suggest for the ones without one.
 *
 * Three reads, never N+1: our chart, their chart, and the mapping table. The
 * suggester then runs purely over the first two.
 *
 * An org with nothing connected gets its chart back with every row `unmapped`,
 * no suggestions and no provider accounts. That is `P1`'s supported
 * configuration and not an error - the ledger is ours, and a chart nobody
 * exports is still a chart.
 */
export async function listAccountIdentities(
  db: Database,
  organizationId: string
): Promise<Result<AccountIdentityMap, Error>> {
  try {
    const chart = await listChartAccounts(db, organizationId)
    if (chart.isErr()) return err(chart.error)
    const accounts = chart.value

    const provider = await resolveAccountingProvider(organizationId)

    const [providerChart, mappings] = await Promise.all([
      provider.listProviderAccounts(organizationId),
      provider.listAccountMappings(organizationId),
    ])
    if (providerChart.isErr()) return err(providerChart.error)
    if (mappings.isErr()) return err(mappings.error)

    const providerAccounts = providerChart.value
    const byProviderId = new Map(providerAccounts.map((a) => [a.id, a]))
    const map = mappings.value

    const suggestions = new Map(
      suggestAccountIdentities(accounts, providerAccounts, new Set([...map.keys()])).map((s) => [
        s.glAccountId,
        s,
      ])
    )

    const broken: string[] = []
    const rows = accounts.map<AccountIdentityRow>((account) => {
      const providerAccountId = map.get(account.id) ?? null

      if (!providerAccountId) {
        const suggestion = suggestions.get(account.id)
        return {
          account,
          state: 'unmapped',
          providerAccountId: null,
          providerAccountName: null,
          providerAccountNumber: null,
          source: null,
          confirmedAt: null,
          liveProviderAccount: null,
          suggestion: suggestion
            ? { account: suggestion.account, reason: suggestion.reason }
            : null,
        }
      }

      // A populated mapping IS a confirmation - the suggester never writes, so
      // the only thing that could have put this here is a person. See
      // `money/quickbooks/account-map.ts` on why there is no stored flag.
      const live = byProviderId.get(providerAccountId) ?? null
      if (!live || !live.active || live.classification !== account.accountType) {
        broken.push(account.code)
      }

      return {
        account,
        state: 'confirmed',
        providerAccountId,
        providerAccountName: live?.fullyQualifiedName ?? null,
        providerAccountNumber: live?.number ?? null,
        source: 'human',
        confirmedAt: null,
        liveProviderAccount: live,
        suggestion: null,
      }
    })

    return ok({ providerId: provider.id, rows, providerAccounts, broken })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to list the account map', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/** What one account-map edit is asking for. */
export interface SetAccountIdentityOptions {
  organizationId: string
  /** The `gl_account` instance to map. */
  glAccountId: string
  /** The provider account to map it to, or null to withdraw the mapping. */
  providerAccountId?: string | null
  actorUserId?: string
}

/**
 * Confirm one pairing, or withdraw one.
 *
 * ## What is validated before anything is written
 *
 * - the account exists in THIS org and is not archived
 * - the provider account exists in the connected system's live chart
 * - it is active
 * - its classification matches ours
 *
 * The last two are the ones that matter, and they are checked HERE rather than
 * only at close time for `setRoleAssignment`'s reason, one level down: a mapping
 * that only fails at a close fails on the night of the close. An entry posted to
 * a provider account in the wrong statement section BALANCES, so no reader
 * downstream can catch it - the confirmation step is the last place a person
 * can.
 *
 * 🛑 The check runs against the LIVE provider chart, not against whatever the
 * screen was showing. A picker rendered five minutes ago may be offering an
 * account somebody has since deactivated in QuickBooks.
 */
export async function setAccountIdentity(
  db: Database,
  options: SetAccountIdentityOptions
): Promise<Result<AccountIdentityRow, Error>> {
  const { organizationId, glAccountId, actorUserId } = options
  const providerAccountId = options.providerAccountId?.trim() || null

  try {
    const chart = await listChartAccounts(db, organizationId)
    if (chart.isErr()) return err(chart.error)

    const account = chart.value.find((row) => row.id === glAccountId)
    if (!account) {
      throw new UnprocessableEntityError(
        `Account ${glAccountId} does not exist in this organization, or has been archived.`,
        { organizationId, glAccountId }
      )
    }

    const provider = await resolveAccountingProvider(organizationId)

    if (!providerAccountId) {
      const cleared = await provider.clearAccountMapping({
        orgId: organizationId,
        glAccountId,
        actorUserId,
      })
      if (cleared.isErr()) return err(cleared.error)
      return ok(unmappedRow(account))
    }

    const providerChart = await provider.listProviderAccounts(organizationId)
    if (providerChart.isErr()) return err(providerChart.error)

    const target = providerChart.value.find((row) => row.id === providerAccountId)
    if (!target) {
      throw new UnprocessableEntityError(
        `No account with id ${providerAccountId} exists in the connected accounting system. Refresh the chart and choose again.`,
        { organizationId, glAccountId, providerAccountId }
      )
    }

    if (!isMappableTo(account, target)) {
      throw new UnprocessableEntityError(
        target.active
          ? `${account.code} ${account.name} is ${classificationArticle(account.accountType)} account, but '${target.fullyQualifiedName}' is ${target.classification}. Posting to it would balance and still be wrong.`
          : `'${target.fullyQualifiedName}' is not active in the connected accounting system. Reactivate it there, or choose another account.`,
        { organizationId, glAccountId, providerAccountId }
      )
    }

    const written = await provider.setAccountMapping({
      orgId: organizationId,
      glAccountId,
      providerAccountId,
      actorUserId,
    })
    if (written.isErr()) return err(written.error)

    return ok({
      account,
      state: 'confirmed',
      providerAccountId,
      providerAccountName: target.fullyQualifiedName,
      providerAccountNumber: target.number,
      source: 'human',
      confirmedAt: new Date().toISOString(),
      liveProviderAccount: target,
      suggestion: null,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to set an account mapping', { error, organizationId, glAccountId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * Confirm every suggestion in one go - the wizard's "accept all" action.
 *
 * ⚠️ This is still a human confirmation under `G19`, not an automatic mapping:
 * the person is shown every proposed pairing and its reason, and this is them
 * agreeing to the set. That is why it lives behind an explicit button and why
 * nothing calls it on connect.
 *
 * Partial success is reported, never rolled back. Nineteen good mappings and one
 * refusal is a better outcome than none, and the refusals are returned so the
 * screen can name them.
 */
export async function confirmSuggestedIdentities(
  db: Database,
  options: { organizationId: string; actorUserId?: string }
): Promise<Result<{ confirmed: number; failures: string[] }, Error>> {
  const listed = await listAccountIdentities(db, options.organizationId)
  if (listed.isErr()) return err(listed.error)

  let confirmed = 0
  const failures: string[] = []

  for (const row of listed.value.rows) {
    if (!row.suggestion) continue
    const result = await setAccountIdentity(db, {
      organizationId: options.organizationId,
      glAccountId: row.account.id,
      providerAccountId: row.suggestion.account.id,
      actorUserId: options.actorUserId,
    })
    if (result.isErr()) failures.push(`${row.account.code}: ${result.error.message}`)
    else confirmed++
  }

  return ok({ confirmed, failures })
}

/**
 * Resolve one account CODE to the connected provider's own account id.
 *
 * 🛑 **The poster's read, and the only one.** `G19` has no default-account
 * fallback and this function has no matching logic of any kind: an account is
 * either confirmed against a provider account or it is not, and "not" refuses
 * with a sentence naming the account and the screen that fixes it. Matching on
 * account NUMBER at post time - what this replaced - looks like a convenience
 * and is a silent misposting waiting for somebody to renumber their chart.
 */
export async function resolveProviderAccountIds(
  db: Database,
  organizationId: string,
  codes: readonly string[]
): Promise<Result<Map<string, string>, Error>> {
  const listed = await listAccountIdentities(db, organizationId)
  if (listed.isErr()) return err(listed.error)

  const byCode = new Map(listed.value.rows.map((row) => [row.account.code, row]))
  const resolved = new Map<string, string>()
  const problems: string[] = []

  for (const code of new Set(codes)) {
    const row = byCode.get(code)
    if (!row) {
      problems.push(`No account in this organization's chart has the code '${code}'.`)
      continue
    }
    if (!row.providerAccountId) {
      problems.push(
        `${code} ${row.account.name} is not mapped to an account in the connected accounting system. Map it under Accounting > Settings > Accounts.`
      )
      continue
    }
    const live = row.liveProviderAccount
    if (!live) {
      problems.push(
        `${code} ${row.account.name} is mapped to an account that no longer exists in the connected accounting system. Re-map it.`
      )
      continue
    }
    if (!live.active) {
      problems.push(
        `${code} ${row.account.name} is mapped to '${live.fullyQualifiedName}', which has been deactivated. Reactivate it or map ${code} elsewhere.`
      )
      continue
    }
    if (live.classification !== row.account.accountType) {
      problems.push(
        `${code} ${row.account.name} is ${classificationArticle(row.account.accountType)} account but is mapped to '${live.fullyQualifiedName}', which is ${live.classification}.`
      )
      continue
    }
    resolved.set(code, row.providerAccountId)
  }

  if (problems.length > 0) {
    return err(new UnprocessableEntityError(problems.join(' '), { organizationId }))
  }
  return ok(resolved)
}

/** The shape every unmapped row takes. One place, so the two callers agree. */
function unmappedRow(account: ChartAccountRow): AccountIdentityRow {
  return {
    account,
    state: 'unmapped',
    providerAccountId: null,
    providerAccountName: null,
    providerAccountNumber: null,
    source: null,
    confirmedAt: null,
    liveProviderAccount: null,
    suggestion: null,
  }
}
