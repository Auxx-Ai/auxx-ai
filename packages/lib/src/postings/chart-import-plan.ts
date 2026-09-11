// packages/lib/src/postings/chart-import-plan.ts
//
// The PURE half of importing a provider's chart of accounts (brief 16 §2.2):
// given what the provider reports, what the org already has, which provider
// accounts are already somebody's identity and which roles are already mapped,
// decide what to create, what to skip and which roles can be assigned without
// asking. No database, no io, client-safe. The writer that executes a plan is
// `chart-import.ts`. The two tables here are DECLARED, not derived: the
// subtype inverse is deliberately narrower than the mechanical inverse of
// `SUBTYPE_PROVIDER_ACCOUNT_TYPES`, and the role match list is short on
// purpose (revenue is the person's call, 16 §2.2).

import type { GlAccountSubtypeValue } from './account-subtype'
import type { AccountRole } from './build-entry'
import { CHART_PACKS } from './default-chart'
import type { ChartAccountRow, ChartImportPlan, ProviderAccount, RoleAssignmentRow } from './types'

/** QuickBooks `AccountType` -> our subtype, where the answer is unambiguous. */
export const PROVIDER_ACCOUNT_TYPE_SUBTYPE: Readonly<Record<string, GlAccountSubtypeValue>> = {
  Bank: 'bank',
  'Accounts Receivable': 'accounts_receivable',
  'Accounts Payable': 'accounts_payable',
  'Credit Card': 'credit_card',
  'Fixed Asset': 'fixed_asset',
  'Cost of Goods Sold': 'cost_of_goods_sold',
  // 'Other Current Asset' deliberately absent: Undeposited Funds, prepaids and
  // Inventory Asset all arrive under it (map-account.ts sends no AccountSubType).
}

/**
 * How a role finds its account among imported ones. Exactly one hit, or nothing.
 *
 * Every other role is left for the Roles tab. Revenue is deliberately absent:
 * QuickBooks ships `Sales`, `Sales of Product Income`, `Services` and a company
 * adds more, and "which of these is product revenue" is the person's call.
 * Names compare through the same `normName` the suggester uses; a plain name
 * or a fully-qualified one both count.
 */
export const ROLE_IMPORT_MATCH: Partial<
  Record<AccountRole, { subtype: GlAccountSubtypeValue } | { names: readonly string[] }>
> = {
  accounts_receivable: { subtype: 'accounts_receivable' },
  accounts_payable: { subtype: 'accounts_payable' },
  undeposited_funds: { names: ['Undeposited Funds'] },
  sales_tax_payable: { names: ['Sales Tax Payable'] },
  equity_retained_earnings: { names: ['Retained Earnings'] },
  // 🛑 No `equity_opening_balance` row: the role was deleted on 2026-09-10
  // because no builder emitted it. `3900 Opening Balance Equity` still arrives
  // from QuickBooks and still lands in the chart - it just carries no role, so
  // there is nothing here to match it to.
  bad_debt_expense: { names: ['Bad Debt', 'Bad Debts', 'Bad Debt Expense'] },
}

/**
 * Case- and whitespace-insensitive compare, then strip the punctuation and
 * filler that differ between two charts describing the same account.
 *
 * A private copy of `suggest-account-identities.ts`'s `normName`, not an
 * import of it: that file is outside this lane's files (brief 16 §4) and this
 * is five lines, small enough that duplicating beats reaching across a lane
 * boundary for it.
 */
function normName(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-_/&,.()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Does `account` carry one of `names`, as a plain name, a fully-qualified one,
 * or the last `Parent:Name` segment of a fully-qualified one?
 *
 * The last check is what makes `'Undeposited Funds'` match a provider account
 * reported only as `'Bank:Undeposited Funds'` when its own `name` field
 * happens to carry the full path too.
 */
function matchesDeclaredName(account: ProviderAccount, names: readonly string[]): boolean {
  const wanted = new Set(names.map(normName))
  const lastSegment = account.fullyQualifiedName.split(':').pop() ?? account.fullyQualifiedName
  return (
    wanted.has(normName(account.name)) ||
    wanted.has(normName(account.fullyQualifiedName)) ||
    wanted.has(normName(lastSegment))
  )
}

/** The single item matching a predicate, or null when none or several do. */
function pickOne<T>(items: readonly T[], predicate: (item: T) => boolean): T | null {
  const hits = items.filter(predicate)
  return hits.length === 1 ? hits[0]! : null
}

/**
 * Plan an import of the provider's chart over the org's current one.
 *
 * `existingIdentities` maps `glAccountId -> providerAccountId`, the read
 * `listAccountIdentities` already makes. Pure and total: never throws on data,
 * and ambiguity (two candidates for one role) yields no candidate.
 *
 * `existingChart` is accepted for the same reason the writer reads it before
 * calling this - it is the caller's context, not this function's - but the
 * plan itself needs nothing from it beyond what `existingRoles` already
 * encodes: a role's current state and the account (if any) behind it.
 */
export function planChartImport(
  providerAccounts: readonly ProviderAccount[],
  _existingChart: readonly ChartAccountRow[],
  existingIdentities: ReadonlyMap<string, string>,
  existingRoles: readonly RoleAssignmentRow[]
): ChartImportPlan {
  const glAccountIdByProviderId = new Map<string, string>()
  for (const [glAccountId, providerAccountId] of existingIdentities) {
    glAccountIdByProviderId.set(providerAccountId, glAccountId)
  }

  const skippedInactive: ProviderAccount[] = []
  const active: ProviderAccount[] = []
  for (const account of providerAccounts) {
    if (account.active) active.push(account)
    else skippedInactive.push(account)
  }

  const create: ChartImportPlan['create'] = []
  const alreadyImported: ChartImportPlan['alreadyImported'] = []
  for (const account of active) {
    const glAccountId = glAccountIdByProviderId.get(account.id)
    if (glAccountId) {
      alreadyImported.push({ providerAccount: account, glAccountId })
      continue
    }
    create.push({
      providerAccount: account,
      code: account.number?.trim() || null,
      name: account.name,
      accountType: account.classification,
      subtype: PROVIDER_ACCOUNT_TYPE_SUBTYPE[account.accountType] ?? null,
    })
  }

  // Every candidate for a role - whether already imported or about to be
  // created - is fair game: both will carry a `gl_account` once the writer is
  // done, and the plan is made before either happens.
  const stateByRole = new Map(existingRoles.map((row) => [row.role, row.state]))
  const roleCandidates: ChartImportPlan['roleCandidates'] = []
  for (const role of Object.keys(ROLE_IMPORT_MATCH) as AccountRole[]) {
    if ((stateByRole.get(role) ?? 'unmapped') !== 'unmapped') continue

    const match = ROLE_IMPORT_MATCH[role]
    if (!match) continue

    const candidate =
      'subtype' in match
        ? pickOne(active, (a) => PROVIDER_ACCOUNT_TYPE_SUBTYPE[a.accountType] === match.subtype)
        : pickOne(active, (a) => matchesDeclaredName(a, match.names))

    if (candidate) {
      roleCandidates.push({
        role,
        match: 'subtype' in match ? 'subtype' : 'name',
        providerAccountId: candidate.id,
      })
    }
  }

  const resolvedRoles = new Set(roleCandidates.map((candidate) => candidate.role))
  const missingCore = CHART_PACKS.core.accounts.filter((account) => {
    if (!account.role) return false
    if (resolvedRoles.has(account.role)) return false
    return (stateByRole.get(account.role) ?? 'unmapped') === 'unmapped'
  })

  return { create, skippedInactive, alreadyImported, roleCandidates, missingCore }
}
