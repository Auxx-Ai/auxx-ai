// packages/lib/src/accounting/opening/opening-fill-plan.ts
//
// The PURE half of filling the opening from a connected provider's balance sheet
// at cutover, inventory included (plans/accounting/tasks/103 §5a). No database,
// no io, client-safe. The writer is `fill-from-provider.ts`.

import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../ledger/builders/entry'
import { accountLabel } from '../ledger/chart/account-label'
import { summariseOpeningTrialBalance } from '../ledger/setup/setup-readiness'
import type { ProviderBalanceRow, ProviderBalanceSheet } from '../ledger/types'
import type { OpeningTrialBalanceRow } from './client'

export interface ProviderOpeningFillInput {
  sheet: ProviderBalanceSheet
  /** `readOpeningTrialBalance().rows`: the whole chart in statement order. */
  rows: readonly OpeningTrialBalanceRow[]
  /** glAccountId -> providerAccountId, from `provider.listAccountMappings`. */
  accountMap: ReadonlyMap<string, string>
  /** role -> glAccountId; only `equity_retained_earnings` is consulted, for the net-income fold. */
  roleAccounts: ReadonlyMap<string, string>
}

/** A provider balance-sheet account with a balance and no account of ours linked to it. */
export interface UnmatchedProviderBalance {
  providerAccountId: string | null
  name: string
  minorSigned: number
}

export interface ProviderOpeningFillPlan {
  /** Every chart row: the provider's figure on a linked row, cleared otherwise. */
  rows: OpeningTrialBalanceRow[]
  /** Provider rows with a non-zero balance and no account of ours. The writer refuses on any. */
  unmatched: UnmatchedProviderBalance[]
  /** Σ `minorSigned` over `unmatched`, debit-positive. */
  unmatchedTotalMinor: number
  netIncome: { minorSigned: number; foldedIntoGlAccountId: string } | null
  /** Σ debits − Σ credits over `rows`. */
  differenceMinor: number
  /** Rows that received a non-zero provider amount. */
  filledCount: number
}

/** `+minor` on a debit line, `-minor` on a credit line, `null`/`null` for zero. */
function signedToDebitCredit(minor: number): {
  debitMinor: number | null
  creditMinor: number | null
} {
  if (minor > 0) return { debitMinor: minor, creditMinor: null }
  if (minor < 0) return { debitMinor: null, creditMinor: -minor }
  return { debitMinor: null, creditMinor: null }
}

function labelRow(row: OpeningTrialBalanceRow | undefined, fallback: string): string {
  return row ? accountLabel({ code: row.accountCode, name: row.accountName }) : fallback
}

/**
 * Plan the opening from the provider's balance sheet over the org's chart.
 *
 * @throws {UnprocessableEntityError} when one provider account is linked from two of
 *   ours (the fill cannot pick one), or net income is non-zero with no retained-earnings
 *   account to fold it into.
 */
export function planProviderOpeningFill(input: ProviderOpeningFillInput): ProviderOpeningFillPlan {
  const { sheet, rows, accountMap, roleAccounts } = input
  const rowById = new Map(rows.map((row) => [row.accountId, row]))

  const glAccountIdsByProviderId = new Map<string, string[]>()
  for (const [glAccountId, providerAccountId] of accountMap) {
    const list = glAccountIdsByProviderId.get(providerAccountId) ?? []
    list.push(glAccountId)
    glAccountIdsByProviderId.set(providerAccountId, list)
  }
  for (const [providerAccountId, glAccountIds] of glAccountIdsByProviderId) {
    if (glAccountIds.length < 2) continue
    const names = glAccountIds.map((id) => labelRow(rowById.get(id), id))
    throw new UnprocessableEntityError(
      `Provider account '${providerAccountId}' is linked from more than one account in your ` +
        `chart: ${names.join(' and ')}. Remove the extra link before filling the opening ` +
        'balances - the fill cannot guess which one the money belongs to.',
      { providerAccountId, glAccountIds }
    )
  }

  const accountRows: ProviderBalanceRow[] = []
  let netIncomeRow: ProviderBalanceRow | null = null
  for (const row of sheet.rows) {
    if (row.kind === 'net_income') {
      if (row.minorSigned !== 0) netIncomeRow = row
      continue
    }
    accountRows.push(row)
  }
  const providerMinorByProviderId = new Map<string, number>()
  for (const row of accountRows) {
    if (row.providerAccountId === null) continue
    const sum = providerMinorByProviderId.get(row.providerAccountId) ?? 0
    providerMinorByProviderId.set(row.providerAccountId, sum + row.minorSigned)
  }

  const amountByGlAccountId = new Map<string, number>()
  for (const row of rows) {
    const providerAccountId = accountMap.get(row.accountId)
    if (!providerAccountId) continue
    const minor = providerMinorByProviderId.get(providerAccountId)
    if (minor !== undefined) amountByGlAccountId.set(row.accountId, minor)
  }

  let netIncome: ProviderOpeningFillPlan['netIncome'] = null
  if (netIncomeRow) {
    const equityGlAccountId = roleAccounts.get(ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS)
    if (!equityGlAccountId) {
      throw new UnprocessableEntityError(
        'The balance sheet reports a non-zero net income, and no account in your chart carries ' +
          'the equity_retained_earnings role to fold it into. Map that role before filling the ' +
          'opening balances.',
        { role: ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS }
      )
    }
    const existing = amountByGlAccountId.get(equityGlAccountId) ?? 0
    amountByGlAccountId.set(equityGlAccountId, existing + netIncomeRow.minorSigned)
    netIncome = { minorSigned: netIncomeRow.minorSigned, foldedIntoGlAccountId: equityGlAccountId }
  }

  let filledCount = 0
  const outputRows: OpeningTrialBalanceRow[] = rows.map((row) => {
    const { debitMinor, creditMinor } = signedToDebitCredit(
      amountByGlAccountId.get(row.accountId) ?? 0
    )
    if (debitMinor || creditMinor) filledCount++
    return { ...row, debitMinor, creditMinor }
  })

  const linkedProviderIds = new Set(
    [...accountMap.entries()].filter(([id]) => rowById.has(id)).map(([, providerId]) => providerId)
  )
  const unmatched: UnmatchedProviderBalance[] = []
  for (const row of accountRows) {
    if (row.minorSigned === 0) continue
    if (row.providerAccountId !== null && linkedProviderIds.has(row.providerAccountId)) continue
    unmatched.push({
      providerAccountId: row.providerAccountId,
      name: row.name,
      minorSigned: row.minorSigned,
    })
  }

  const differenceMinor = summariseOpeningTrialBalance(
    outputRows.flatMap((row) => [
      ...(row.debitMinor ? [{ direction: 'debit' as const, amountMinor: row.debitMinor }] : []),
      ...(row.creditMinor ? [{ direction: 'credit' as const, amountMinor: row.creditMinor }] : []),
    ])
  ).differenceMinor

  return {
    rows: outputRows,
    unmatched,
    unmatchedTotalMinor: unmatched.reduce((sum, row) => sum + row.minorSigned, 0),
    netIncome,
    differenceMinor,
    filledCount,
  }
}
