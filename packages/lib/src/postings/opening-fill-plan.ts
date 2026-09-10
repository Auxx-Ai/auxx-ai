// packages/lib/src/postings/opening-fill-plan.ts
//
// The PURE half of suggesting opening balances from a connected accounting
// provider's balance sheet (plans/accounting/tasks/19-opening-balances-from-the-provider.md
// section 4.2-4.4). Given the provider's balance sheet, the whole opening trial
// balance VIEW - `readOpeningTrialBalance().rows`, which already carries the
// locked inventory rows valued from the count settings - the confirmed account
// map, and the four roles this planner consults, decide what each row should
// hold, what the three inventory settings should hold, what did not match, and
// what the fill leaves unresolved. No database, no io, client-safe. The writer
// that executes a plan is `opening-trial-balance/fill-from-provider.ts`.
//
// Sibling of `chart-import-plan.ts`: same style, same "declare, don't derive"
// discipline, same "collect every problem, refuse once, naming all of them"
// posture inherited from `resolve-roles.ts`.
//
// 🔧 One deviation from an earlier draft of brief 19 section 4.2, deliberate:
// this takes the trial balance's own rows rather than a bare chart plus a
// `countMinorByRole` record, because the rows ALREADY carry `lockedByRole` and
// the count value `readOpeningTrialBalance` overlaid onto them. That is exactly
// the section 4.3 rule - "the lines the fill saves are what `persist` would
// have saved from the same grid" - read backwards: the locked rows this
// planner must re-emit unchanged are the same locked rows the read already
// built, so taking them as input is what keeps the two from ever disagreeing.

import { formatCurrency } from '@auxx/utils'
import { UnprocessableEntityError } from '../errors'
import { accountLabel } from './account-label'
import { ACCOUNT_ROLES } from './build-entry'
import type { OpeningTrialBalanceRow } from './opening-trial-balance/client'
import { summariseOpeningTrialBalance } from './setup-readiness'
import type { ProviderBalanceRow, ProviderBalanceSheet } from './types'

/** The three inventory roles this planner extracts, and the setting field each fills. */
const INVENTORY_ROLE_FIELDS = [
  { role: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS, field: 'qboOpeningRawMaterials' as const },
  { role: ACCOUNT_ROLES.INVENTORY_WIP, field: 'qboOpeningWip' as const },
  { role: ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS, field: 'qboOpeningFinishedGoods' as const },
]

export interface ProviderOpeningFillInput {
  sheet: ProviderBalanceSheet
  /** `readOpeningTrialBalance().rows`: the whole chart in statement order, locked rows already valued from the count settings. */
  rows: readonly OpeningTrialBalanceRow[]
  /** glAccountId -> providerAccountId, from `provider.listAccountMappings`. */
  accountMap: ReadonlyMap<string, string>
  /** role -> glAccountId for the four roles this planner consults: the three INVENTORY_ROLES and equity_retained_earnings. Missing means unassigned. */
  roleAccounts: ReadonlyMap<string, string>
}

export interface ProviderOpeningFillPlan {
  /** Every chart row; provider amounts on linked rows; locked rows keep their count value untouched. */
  rows: OpeningTrialBalanceRow[]
  /** The provider column on the "Opening inventory" wizard page. */
  inventory: {
    qboOpeningRawMaterials: number | null
    qboOpeningWip: number | null
    qboOpeningFinishedGoods: number | null
  }
  /** Set, naming the shared account, when two or more inventory roles resolve to one account (section 4.3.1). Then all three `inventory` figures above are null. */
  inventoryRefusal: string | null
  /** Provider rows with a non-zero balance and no account of ours. */
  unmatched: { providerAccountId: string | null; name: string; minorSigned: number }[]
  /** Σ `minorSigned` over `unmatched`, debit-positive. */
  unmatchedTotalMinor: number
  netIncome: { minorSigned: number; foldedIntoGlAccountId: string } | null
  /** Σ debits − Σ credits over `rows`, locked rows included at their count value. */
  differenceMinor: number
  /** Σ over the three inventory roles of (provider figure − count), null count as 0. When `inventoryRefusal` is set, the shared account's provider figure counts once. */
  inventoryGapMinor: number
  /** Rows that received a provider amount. Locked rows do not count - they keep the count value, not a provider one. */
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

/** A row's identity, for naming it in a refusal - `accountLabel` over the two fields a trial-balance row carries. */
function labelRow(row: OpeningTrialBalanceRow | undefined, fallback: string): string {
  return row ? accountLabel({ code: row.accountCode, name: row.accountName }) : fallback
}

/**
 * Plan an opening-balance fill from the provider's balance sheet over the
 * org's trial balance view. Pure and total except for two refusals that are
 * genuinely programmer/setup errors rather than data the caller can act
 * around silently - see the two `throw`s below, both `UnprocessableEntityError`
 * so the lib fill function's `guard` converts them.
 */
export function planProviderOpeningFill(input: ProviderOpeningFillInput): ProviderOpeningFillPlan {
  const { sheet, rows, accountMap, roleAccounts } = input

  const rowById = new Map(rows.map((row) => [row.accountId, row]))

  // Section 0.6 / 4.2: invert the account map by COLLECTING. A provider id
  // claimed by two or more of our accounts is a refusal naming both - nothing
  // here may guess which one the money belongs to.
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
      `QuickBooks account '${providerAccountId}' is mapped from more than one account in your ` +
        `chart: ${names.join(' and ')}. Fix the extra mapping on the Account map page before ` +
        'suggesting opening balances - the fill cannot guess which one the money belongs to.',
      { providerAccountId, glAccountIds: glAccountIds.join(',') }
    )
  }
  const glAccountIdByProviderId = new Map<string, string>()
  for (const [providerAccountId, glAccountIds] of glAccountIdsByProviderId) {
    glAccountIdByProviderId.set(providerAccountId, glAccountIds[0]!)
  }

  // Split the sheet: account rows carry money for one of our accounts; the one
  // computed `net_income` row does not, and a zero one is not a real fold.
  const accountRows: ProviderBalanceRow[] = []
  let netIncomeRow: ProviderBalanceRow | null = null
  for (const row of sheet.rows) {
    if (row.kind === 'net_income') {
      if (row.minorSigned !== 0) netIncomeRow = row
      continue
    }
    accountRows.push(row)
  }
  const providerMinorByProviderId = new Map(
    accountRows
      .filter(
        (row): row is ProviderBalanceRow & { providerAccountId: string } =>
          row.providerAccountId !== null
      )
      .map((row) => [row.providerAccountId, row.minorSigned])
  )

  // The accounts this org has already locked to the count settings, straight
  // from the rows the caller read - not recomputed from `roleAccounts`, so a
  // shared-account row (section 4.3.1's "last role written wins" rendering
  // bug) is trusted for what it already is: one locked row.
  const lockedAccountIds = new Set(
    rows.filter((row) => row.lockedByRole).map((row) => row.accountId)
  )

  // ── Section 4.3.1: the three inventory roles, and whether they collide ────
  const inventoryAccountByRole = new Map<string, string>()
  for (const { role } of INVENTORY_ROLE_FIELDS) {
    const glAccountId = roleAccounts.get(role)
    if (glAccountId) inventoryAccountByRole.set(role, glAccountId)
  }
  const inventoryRolesByAccount = new Map<string, string[]>()
  for (const [role, glAccountId] of inventoryAccountByRole) {
    const list = inventoryRolesByAccount.get(glAccountId) ?? []
    list.push(role)
    inventoryRolesByAccount.set(glAccountId, list)
  }
  const sharedAccountId = [...inventoryRolesByAccount.entries()].find(
    ([, roles]) => roles.length >= 2
  )?.[0]

  const inventory: ProviderOpeningFillPlan['inventory'] = {
    qboOpeningRawMaterials: null,
    qboOpeningWip: null,
    qboOpeningFinishedGoods: null,
  }
  let inventoryRefusal: string | null = null

  if (sharedAccountId) {
    const providerAccountId = accountMap.get(sharedAccountId)
    const balance = providerAccountId ? (providerMinorByProviderId.get(providerAccountId) ?? 0) : 0
    const label = labelRow(rowById.get(sharedAccountId), sharedAccountId)
    inventoryRefusal =
      `QuickBooks holds a single ${label} balance of ${formatCurrency(balance)}, and your raw ` +
      'materials, work in process and finished goods roles all point at it. A split is a ' +
      'judgement about your own stock, not something QuickBooks can answer. Enter the three ' +
      'figures from your count.'
  } else {
    for (const { role, field } of INVENTORY_ROLE_FIELDS) {
      const glAccountId = inventoryAccountByRole.get(role)
      const providerAccountId = glAccountId ? accountMap.get(glAccountId) : undefined
      inventory[field] = providerAccountId
        ? (providerMinorByProviderId.get(providerAccountId) ?? null)
        : null
    }
  }

  // ── Every other row: the provider's figure, or a clear cell ──────────────
  // Locked rows (the inventory accounts) are excluded here - their value is
  // `inventory` above, never `rows`, per section 4.3's central rule.
  const providerAmountByGlAccountId = new Map<string, number>()
  for (const row of rows) {
    if (row.lockedByRole) continue
    const providerAccountId = accountMap.get(row.accountId)
    if (!providerAccountId) continue
    const minor = providerMinorByProviderId.get(providerAccountId)
    if (minor === undefined) continue
    providerAmountByGlAccountId.set(row.accountId, minor)
  }

  // ── Section 5.3: net income folds into retained earnings ─────────────────
  let netIncome: ProviderOpeningFillPlan['netIncome'] = null
  if (netIncomeRow) {
    const equityGlAccountId = roleAccounts.get(ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS)
    if (!equityGlAccountId) {
      throw new UnprocessableEntityError(
        'QuickBooks reports a non-zero Net Income on this balance sheet, and no account in your ' +
          'chart carries the equity_retained_earnings role to fold it into. Map that role on the ' +
          'Roles tab before suggesting opening balances.',
        { role: ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS }
      )
    }
    const existing = providerAmountByGlAccountId.get(equityGlAccountId) ?? 0
    const combined = existing + netIncomeRow.minorSigned
    providerAmountByGlAccountId.set(equityGlAccountId, combined)
    netIncome = { minorSigned: netIncomeRow.minorSigned, foldedIntoGlAccountId: equityGlAccountId }
  }

  // ── Build the output rows ─────────────────────────────────────────────────
  let filledCount = 0
  const outputRows: OpeningTrialBalanceRow[] = rows.map((row) => {
    if (row.lockedByRole) return row
    const minor = providerAmountByGlAccountId.get(row.accountId)
    if (minor === undefined) {
      return { ...row, debitMinor: null, creditMinor: null }
    }
    const { debitMinor, creditMinor } = signedToDebitCredit(minor)
    if (debitMinor || creditMinor) filledCount++
    return { ...row, debitMinor, creditMinor }
  })

  // ── Section 4.4: unmatched provider rows ──────────────────────────────────
  const unmatched: ProviderOpeningFillPlan['unmatched'] = []
  for (const row of accountRows) {
    if (row.providerAccountId === null || row.minorSigned === 0) continue
    const glAccountId = glAccountIdByProviderId.get(row.providerAccountId)
    if (glAccountId && lockedAccountIds.has(glAccountId)) continue // handled by `inventory`, never unmatched
    if (glAccountId && rowById.has(glAccountId)) continue // matched normally, already in `rows`
    unmatched.push({
      providerAccountId: row.providerAccountId,
      name: row.name,
      minorSigned: row.minorSigned,
    })
  }
  const unmatchedTotalMinor = unmatched.reduce((sum, row) => sum + row.minorSigned, 0)

  // ── Verdict ────────────────────────────────────────────────────────────────
  const differenceMinor = summariseOpeningTrialBalance(
    outputRows.flatMap((row) => [
      ...(row.debitMinor ? [{ direction: 'debit' as const, amountMinor: row.debitMinor }] : []),
      ...(row.creditMinor ? [{ direction: 'credit' as const, amountMinor: row.creditMinor }] : []),
    ])
  ).differenceMinor

  let inventoryGapMinor: number
  if (sharedAccountId) {
    const providerAccountId = accountMap.get(sharedAccountId)
    const providerMinor = providerAccountId
      ? (providerMinorByProviderId.get(providerAccountId) ?? 0)
      : 0
    const countMinor = rowById.get(sharedAccountId)?.debitMinor ?? 0
    inventoryGapMinor = providerMinor - countMinor
  } else {
    inventoryGapMinor = INVENTORY_ROLE_FIELDS.reduce((sum, { role, field }) => {
      const glAccountId = inventoryAccountByRole.get(role)
      const providerMinor = inventory[field] ?? 0
      const countMinor = glAccountId ? (rowById.get(glAccountId)?.debitMinor ?? 0) : 0
      return sum + (providerMinor - countMinor)
    }, 0)
  }

  return {
    rows: outputRows,
    inventory,
    inventoryRefusal,
    unmatched,
    unmatchedTotalMinor,
    netIncome,
    differenceMinor,
    inventoryGapMinor,
    filledCount,
  }
}
