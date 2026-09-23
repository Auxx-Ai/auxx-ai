// packages/lib/src/accounting/ledger/chart/chart-import-plan.ts
//
// The PURE half of importing a provider's chart of accounts (brief 16 §2.2):
// given what the provider reports, what the org already has, which provider
// accounts are already somebody's identity and which roles are already mapped,
// decide what to create, what to skip and which roles can be assigned without
// asking. No database, no io, client-safe. The writer that executes a plan is
// `chart-import.ts`. Provider-neutral: a provider's own type vocabulary is
// translated to `subtype` / `roleHint` inside its adapter, never here.

import {
  ACCOUNT_ROLES,
  type AccountRole,
  ROLE_ACCOUNT_TYPES,
  ROLES_WITHOUT_DEFAULT,
} from '../builders/entry'
import type { ChartAccountRow, ChartImportPlan, ProviderAccount, RoleAssignmentRow } from '../types'
import type { GlAccountSubtypeValue } from './account-subtype'
import { CHART_PACKS } from './default-chart'

/** How a role finds its account when the provider gave no unique `roleHint` for it. */
export interface RoleImportMatch {
  subtype?: GlAccountSubtypeValue
  names?: readonly string[]
  /** Last resort: the only account of the role's classification is the one. */
  sole?: true
}

/**
 * The fallbacks after the provider's `roleHint`, tried in order: our subtype,
 * then names (compared through `normName`, plain or fully-qualified), then
 * `sole`. A role absent here matches on its hint alone.
 */
export const ROLE_IMPORT_MATCH: Readonly<Partial<Record<AccountRole, RoleImportMatch>>> = {
  accounts_receivable: { subtype: 'accounts_receivable' },
  accounts_payable: { subtype: 'accounts_payable' },
  undeposited_funds: { names: ['Undeposited Funds'] },
  sales_tax_payable: { names: ['Sales Tax Payable'] },
  equity_retained_earnings: { names: ['Retained Earnings'] },
  equity_opening_balance: { names: ['Opening Balance Equity'] },
  bad_debt_expense: { names: ['Bad Debt', 'Bad Debts', 'Bad Debt Expense'] },
  discounts_given: { names: ['Discounts given'] },
  revenue_product: {
    names: ['Sales', 'Sales of Product Income', 'Product Sales', 'Product Revenue'],
    // Several unmatched income accounts make this a question, never a minted duplicate.
    sole: true,
  },
  revenue_shipping: {
    names: ['Shipping Income', 'Shipping Revenue', 'Shipping and Delivery Income'],
  },
  revenue_service: { names: ['Services', 'Service Income', 'Service Revenue'] },
  revenue_returns_allowances: {
    names: ['Sales Returns and Allowances', 'Returns and Allowances'],
  },
  inventory_finished_goods: { subtype: 'inventory' },
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

interface RoleMatchTier {
  kind: ChartImportPlan['roleCandidates'][number]['match']
  test: (account: ProviderAccount) => boolean
}

type RoleResolution =
  | { kind: 'none' }
  | { kind: 'one'; account: ProviderAccount; match: RoleMatchTier['kind'] }
  | { kind: 'ambiguous'; accounts: ProviderAccount[] }

/**
 * The first tier with any hit decides; several hits are narrowed by the later
 * tiers, and whatever is still plural is ambiguous rather than guessed.
 */
function resolveRole(
  pool: readonly ProviderAccount[],
  tiers: readonly RoleMatchTier[],
  narrowed = false
): RoleResolution {
  const [tier, ...rest] = tiers
  if (!tier) return narrowed ? { kind: 'ambiguous', accounts: [...pool] } : { kind: 'none' }
  const hits = pool.filter(tier.test)
  if (hits.length === 0) return resolveRole(pool, rest, narrowed)
  if (hits.length === 1) return { kind: 'one', account: hits[0]!, match: tier.kind }
  return resolveRole(hits, rest, true)
}

function roleTiers(role: AccountRole): RoleMatchTier[] {
  const match = ROLE_IMPORT_MATCH[role]
  const tiers: RoleMatchTier[] = [{ kind: 'hint', test: (a) => a.roleHint === role }]
  const subtype = match?.subtype
  if (subtype) tiers.push({ kind: 'subtype', test: (a) => a.subtype === subtype })
  const names = match?.names
  if (names) tiers.push({ kind: 'name', test: (a) => matchesDeclaredName(a, names) })
  if (match?.sole) tiers.push({ kind: 'sole', test: () => true })
  return tiers
}

/** The requested ids plus every unlinked, active ancestor they need to nest under. */
function withUnlinkedAncestors(
  ids: ReadonlySet<string>,
  active: readonly ProviderAccount[],
  isLinked: (providerAccountId: string) => boolean
): Set<string> {
  const byId = new Map(active.map((account) => [account.id, account]))
  const closure = new Set<string>()
  for (const id of ids) {
    let current = byId.get(id)
    while (current && !closure.has(current.id)) {
      closure.add(current.id)
      const parent = current.parentId ? byId.get(current.parentId) : undefined
      current = parent && !isLinked(parent.id) ? parent : undefined
    }
  }
  return closure
}

export interface PlanChartImportOptions {
  /** A targeted import: only these provider accounts and their missing parents, never core. */
  onlyProviderAccountIds?: ReadonlySet<string>
}

/**
 * Order a batch of about-to-be-created accounts so a parent always precedes
 * its children - the writer needs its `providerId -> glAccountId` map already
 * holding a parent by the time a child asks to be created under it.
 *
 * Only orders WITHIN this batch: a parent that is already imported, skipped
 * as inactive, or simply not among `accounts` is left for the writer to
 * resolve (or not find) through the map it keeps beside `alreadyImported` -
 * see `chart-import.ts`.
 */
function topoSortByParent(accounts: readonly ProviderAccount[]): ProviderAccount[] {
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const placed = new Set<string>()
  const ordered: ProviderAccount[] = []

  function place(account: ProviderAccount, ancestors: ReadonlySet<string>): void {
    if (placed.has(account.id)) return
    const parent = account.parentId ? byId.get(account.parentId) : undefined
    // A cycle in the provider's own data (never expected) stops rather than loops.
    if (parent && !ancestors.has(parent.id)) place(parent, new Set(ancestors).add(account.id))
    if (placed.has(account.id)) return
    placed.add(account.id)
    ordered.push(account)
  }

  for (const account of accounts) place(account, new Set())
  return ordered
}

/**
 * Plan an import of the provider's chart over the org's current one.
 *
 * `existingIdentities` maps `glAccountId -> providerAccountId`, the read
 * `listAccountIdentities` already makes. Pure and total: never throws on data,
 * and ambiguity (two candidates for one role) yields no candidate.
 */
export function planChartImport(
  providerAccounts: readonly ProviderAccount[],
  existingChart: readonly ChartAccountRow[],
  existingIdentities: ReadonlyMap<string, string>,
  existingRoles: readonly RoleAssignmentRow[],
  options: PlanChartImportOptions = {}
): ChartImportPlan {
  const glAccountIdByProviderId = new Map<string, string>()
  for (const [glAccountId, providerAccountId] of existingIdentities) {
    glAccountIdByProviderId.set(providerAccountId, glAccountId)
  }
  const chartById = new Map(existingChart.map((row) => [row.id, row]))

  const skippedInactive: ProviderAccount[] = []
  const active: ProviderAccount[] = []
  for (const account of providerAccounts) {
    if (account.active) active.push(account)
    else skippedInactive.push(account)
  }

  const only = options.onlyProviderAccountIds
  const inScope = only
    ? withUnlinkedAncestors(only, active, (id) => glAccountIdByProviderId.has(id))
    : null

  const toCreate: ProviderAccount[] = []
  const alreadyImported: ChartImportPlan['alreadyImported'] = []
  const reparent: ChartImportPlan['reparent'] = []
  for (const account of active) {
    if (inScope && !inScope.has(account.id)) continue
    const glAccountId = glAccountIdByProviderId.get(account.id)
    if (!glAccountId) {
      toCreate.push(account)
      continue
    }
    alreadyImported.push({ providerAccount: account, glAccountId })

    // A refresh only ADDS what the provider has (CHART-HIERARCHY §6): an
    // account imported before the parent link existed, or before it gained
    // one over there, gets its parent set and nothing else about it changes.
    const existingRow = chartById.get(glAccountId)
    if (account.parentId && existingRow && existingRow.parentId === null) {
      // Commit 2a027b6c0's stopgap named a parentless import by its full
      // path; restore the leaf name now that there is a real parent to carry
      // the rest of the path instead.
      const leafName = existingRow.name === account.fullyQualifiedName ? account.name : null
      reparent.push({ glAccountId, providerParentId: account.parentId, leafName })
    }
  }

  // Parents before children, so the writer's provider-id -> gl-account-id map
  // already holds a parent by the time a child looks it up. A parent that is
  // inactive (filtered into `skippedInactive` above, never here) or otherwise
  // not created this run means the child simply imports top-level - the
  // writer skips a `providerParentId` it cannot resolve rather than refusing.
  const create: ChartImportPlan['create'] = topoSortByParent(toCreate).map((account) => ({
    providerAccount: account,
    code: account.number?.trim() || null,
    name: account.name,
    providerParentId: account.parentId,
    accountType: account.classification,
    subtype: account.subtype ?? null,
  }))

  // Candidates come from the whole active chart, already imported or about to
  // be, and only from accounts of the role's own statement classification.
  const stateByRole = new Map(existingRoles.map((row) => [row.role, row.state]))
  const roleCandidates: ChartImportPlan['roleCandidates'] = []
  const ambiguousRoles: ChartImportPlan['ambiguousRoles'] = []
  const contestedRoles = new Set<AccountRole>()
  for (const role of Object.values(ACCOUNT_ROLES)) {
    if ((ROLES_WITHOUT_DEFAULT as readonly string[]).includes(role)) continue
    if ((stateByRole.get(role) ?? 'unmapped') !== 'unmapped') continue

    const pool = active.filter((a) => a.classification === ROLE_ACCOUNT_TYPES[role])
    const resolution = resolveRole(pool, roleTiers(role))
    if (resolution.kind === 'none') continue
    contestedRoles.add(role)
    if (resolution.kind === 'ambiguous') {
      ambiguousRoles.push({ role, providerAccountIds: resolution.accounts.map((a) => a.id) })
      continue
    }
    // A targeted import assigns roles only to what it brings in.
    if (inScope && !inScope.has(resolution.account.id)) continue
    roleCandidates.push({ role, match: resolution.match, providerAccountId: resolution.account.id })
  }

  // Minted only where the provider has no candidate at all: an ambiguous role is
  // a person's question, and a duplicate of an account they already have is no answer.
  const missingCore = inScope
    ? []
    : CHART_PACKS.core.accounts.filter(
        (account) =>
          account.role !== undefined &&
          !contestedRoles.has(account.role) &&
          (stateByRole.get(account.role) ?? 'unmapped') === 'unmapped'
      )

  return {
    create,
    skippedInactive: only ? skippedInactive.filter((a) => only.has(a.id)) : skippedInactive,
    alreadyImported,
    reparent,
    roleCandidates,
    ambiguousRoles,
    missingCore,
  }
}
