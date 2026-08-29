// apps/web/src/components/accounting/fixtures.ts
//
// 🛑 PLACEHOLDER DATA. Delete this file when the four missing procedures land.
//
// plans/money/tasks/13-accounting-ui.md §4 lists four tRPC procedures this UI
// needs that do not exist yet:
//
//   * `ledger.previewMonthEnd({ periodKey })`  — `ledger.preview` takes a
//     CLIENT-SUPPLIED line array, so nothing today can build a month-end entry
//     from a period key.
//   * `ledger.postMonthEnd({ periodKey })`     — same.
//   * `ledger.get(id)`                         — there is no read surface for a
//     posting at all; `listUnpostedPeriods` returns claimed-but-not-posted only.
//   * the role-map read/write                  — `GlRoleAssignment` exists and
//     `resolveRoles` fails closed, but no procedure can read or create one.
//
// Until they exist the screens render from here, so the whole surface can be
// looked at and driven. Every shape below is the REAL lib type imported from
// `@auxx/lib/postings/client` — not a hand-rolled lookalike — so swapping a
// fixture for a query is a one-line change and the compiler catches any drift.
//
// ⚠️ Numbers are integer MINOR units everywhere, as they are in the real thing.
// Nothing here should ever be read as dollars.

import type {
  AccountRole,
  BooksBalanceReport,
  EntryPreview,
  GlAccountTypeValue,
  PostingAssertions,
  PostingDraftV1,
  PostResult,
  ResolvedPostingLine,
  UnpostedPeriod,
} from '@auxx/lib/postings/client'

/** Where the fixture org sits in the calendar, so every screen agrees on "now". */
export const FIXTURE_CUTOFF_PERIOD = '2026-12'
export const FIXTURE_CURRENT_PERIOD = '2027-03'
export const FIXTURE_BOOK_TIME_ZONE = 'America/New_York'

/** Months from the cutoff through the current period, oldest first. */
export const FIXTURE_PERIODS = ['2027-01', '2027-02', '2027-03'] as const

export type FixturePeriodState = 'open' | 'posted' | 'locked'

export interface FixturePeriodSummary {
  periodKey: string
  state: FixturePeriodState
  docNumber?: string
  totalMinor?: number
  /** Present once posted. */
  postedAt?: string
  /** `0` for an original; a reversal chain climbs from there. */
  revision: number
}

export const FIXTURE_PERIOD_SUMMARIES: FixturePeriodSummary[] = [
  {
    periodKey: '2027-01',
    state: 'locked',
    docNumber: 'AUXX-MEI-2027-01',
    totalMinor: 4_812_00,
    postedAt: '2027-02-03T14:22:00.000Z',
    revision: 0,
  },
  {
    periodKey: '2027-02',
    state: 'posted',
    docNumber: 'AUXX-MEI-2027-02',
    totalMinor: 6_204_00,
    postedAt: '2027-03-02T09:41:00.000Z',
    // A reversal + re-entry happened here, so the revision strip has something
    // to render. See FIXTURE_REVISIONS.
    revision: 2,
  },
  { periodKey: '2027-03', state: 'open', revision: 0 },
]

/** The `?posting=<id>` drawer's rows for `2027-02`. Newest revision first. */
export interface FixtureRevision {
  glPostingId: string
  revision: number
  status: 'posted' | 'reversed'
  docNumber: string
  postedAt: string
  memo?: string
}

export const FIXTURE_REVISIONS: Record<string, FixtureRevision[]> = {
  '2027-02': [
    {
      glPostingId: 'glp_2027_02_r2',
      revision: 2,
      status: 'posted',
      docNumber: 'AUXX-MEI-2027-02',
      postedAt: '2027-03-02T09:41:00.000Z',
      memo: 'Re-entry after the February shrinkage correction.',
    },
    {
      glPostingId: 'glp_2027_02_r1',
      revision: 1,
      status: 'posted',
      docNumber: 'AUXX-MEI-2027-02',
      postedAt: '2027-03-02T09:38:00.000Z',
      memo: 'Reversal of revision 0.',
    },
    {
      glPostingId: 'glp_2027_02_r0',
      revision: 0,
      status: 'reversed',
      docNumber: 'AUXX-MEI-2027-02',
      postedAt: '2027-03-01T17:03:00.000Z',
    },
  ],
}

/**
 * The account code + name each role resolves to in the fixture org.
 *
 * Mirrors the seeded 29-account chart. `ppv` and `inventory_wip` are absent on
 * purpose: nothing emits them under L1, and `13-accounting-ui.md` §5.4 requires
 * the role map to let those two be marked unused rather than blocking Preview.
 */
export const FIXTURE_ROLE_ACCOUNTS: Partial<Record<AccountRole, { code: string; name: string }>> = {
  cash: { code: '1010', name: 'Operating Cash' },
  inventory_raw_materials: { code: '1310', name: 'Inventory — Raw Materials' },
  inventory_finished_goods: { code: '1330', name: 'Inventory — Finished Goods' },
  accounts_payable: { code: '2010', name: 'Accounts Payable' },
  payroll_clearing: { code: '2110', name: 'Payroll Clearing' },
  freight_accrual: { code: '2150', name: 'Inbound Freight & Brokerage Accrual' },
  grni: { code: '2160', name: 'Goods Received Not Invoiced' },
  duties_accrual: { code: '2170', name: 'Duties Accrual' },
  cogs_product_cost: { code: '5000', name: 'COGS — Product Cost' },
  applied_overhead: { code: '5020', name: 'COGS — Applied Overhead' },
  inventory_count_variance: { code: '5095', name: 'Inventory Count Variance' },
}

/** One row of the org's editable chart (`gl_account`, an EntityInstance). */
export interface FixtureGlAccount {
  id: string
  code: string
  name: string
  accountType: GlAccountTypeValue
  isActive: boolean
}

export const FIXTURE_CHART: FixtureGlAccount[] = [
  { id: 'gla_1010', code: '1010', name: 'Operating Cash', accountType: 'asset', isActive: true },
  {
    id: 'gla_1310',
    code: '1310',
    name: 'Inventory — Raw Materials',
    accountType: 'asset',
    isActive: true,
  },
  {
    id: 'gla_1320',
    code: '1320',
    name: 'Inventory — Work in Process',
    accountType: 'asset',
    isActive: true,
  },
  {
    id: 'gla_1330',
    code: '1330',
    name: 'Inventory — Finished Goods',
    accountType: 'asset',
    isActive: true,
  },
  {
    id: 'gla_2010',
    code: '2010',
    name: 'Accounts Payable',
    accountType: 'liability',
    isActive: true,
  },
  {
    id: 'gla_2110',
    code: '2110',
    name: 'Payroll Clearing',
    accountType: 'liability',
    isActive: true,
  },
  {
    id: 'gla_2150',
    code: '2150',
    name: 'Inbound Freight & Brokerage Accrual',
    accountType: 'liability',
    isActive: true,
  },
  {
    id: 'gla_2160',
    code: '2160',
    name: 'Goods Received Not Invoiced',
    accountType: 'liability',
    isActive: true,
  },
  {
    id: 'gla_2170',
    code: '2170',
    name: 'Duties Accrual',
    accountType: 'liability',
    isActive: true,
  },
  {
    id: 'gla_5000',
    code: '5000',
    name: 'COGS — Product Cost',
    accountType: 'expense',
    isActive: true,
  },
  {
    id: 'gla_5020',
    code: '5020',
    name: 'COGS — Applied Overhead',
    accountType: 'expense',
    isActive: true,
  },
  {
    id: 'gla_5090',
    code: '5090',
    name: 'Purchase Price Variance',
    accountType: 'expense',
    isActive: true,
  },
  {
    id: 'gla_5095',
    code: '5095',
    name: 'Inventory Count Variance',
    accountType: 'expense',
    isActive: true,
  },
]

/** Which roles the fixture org has confirmed, vs merely suggested. `G19` step 4. */
export type FixtureRoleAssignmentState = 'confirmed' | 'suggested' | 'unmapped' | 'unused'

export const FIXTURE_ROLE_ASSIGNMENT_STATE: Record<string, FixtureRoleAssignmentState> = {
  cash: 'confirmed',
  inventory_raw_materials: 'confirmed',
  inventory_finished_goods: 'confirmed',
  accounts_payable: 'confirmed',
  payroll_clearing: 'confirmed',
  freight_accrual: 'suggested',
  grni: 'confirmed',
  duties_accrual: 'suggested',
  cogs_product_cost: 'confirmed',
  applied_overhead: 'confirmed',
  inventory_count_variance: 'confirmed',
  // Nothing emits either of these under L1 — the map must let them be excused.
  ppv: 'unused',
  inventory_wip: 'unused',
}

// ── The entry ───────────────────────────────────────────────────────────────

function line(
  accountCode: string,
  accountName: string,
  direction: 'debit' | 'credit',
  amount: number,
  memo: string,
  sortOrder: number
): ResolvedPostingLine & { accountRole: string } {
  return {
    accountCode,
    accountName,
    accountRole: '',
    direction,
    amount,
    memo,
    sourceType: 'month_end_inventory',
    sourceId: '2027-03',
    sortOrder,
  }
}

/**
 * March 2027's proposed entry.
 *
 * Balanced by construction, as the real builder guarantees. `5000` is the plug —
 * which is exactly why `13-accounting-ui.md` insists the roll-forward is shown
 * beside the JE: flipping any one lane's direction is absorbed at twice the
 * error and the entry still balances.
 */
export const FIXTURE_PREVIEW_LINES: Array<ResolvedPostingLine & { accountRole: string }> = [
  {
    ...line('1310', 'Inventory — Raw Materials', 'debit', 822_000, 'Raw materials movement', 0),
    accountRole: 'inventory_raw_materials',
  },
  {
    ...line('1330', 'Inventory — Finished Goods', 'credit', 301_000, 'Finished goods movement', 1),
    accountRole: 'inventory_finished_goods',
  },
  {
    ...line('2110', 'Payroll Clearing', 'credit', 412_000, 'Absorbed assembly labor', 2),
    accountRole: 'payroll_clearing',
  },
  {
    ...line('5020', 'COGS — Applied Overhead', 'credit', 268_000, 'Absorbed overhead', 3),
    accountRole: 'applied_overhead',
  },
  {
    ...line('5095', 'Inventory Count Variance', 'debit', 31_000, 'Cycle-count shrinkage', 4),
    accountRole: 'inventory_count_variance',
  },
  {
    ...line('5000', 'COGS — Product Cost', 'debit', 128_000, 'Balancing figure', 5),
    accountRole: 'cogs_product_cost',
  },
]

export const FIXTURE_PREVIEW: EntryPreview = {
  postingType: 'month_end_inventory',
  periodKey: '2027-03',
  txnDate: '2027-03-31',
  docNumber: 'AUXX-MEI-2027-03',
  lines: FIXTURE_PREVIEW_LINES,
  totalMinor: 981_000,
}

/**
 * The same preview, refused.
 *
 * 🛑 Task 09 §4 requires an uncosted post-cutoff movement to FAIL the close and
 * NAME ITSELF rather than be filtered — filtering would produce a balanced entry
 * that understates inventory with no signal. So the blocker text carries the row.
 */
export const FIXTURE_PREVIEW_BLOCKED: EntryPreview = {
  ...FIXTURE_PREVIEW,
  lines: [],
  totalMinor: 0,
  blockedBy: {
    status: 'account_unmapped',
    error: 'No account is mapped for role "applied_overhead".',
  },
}

/** `before` and `after`, which is what the roll-forward renders. */
export const FIXTURE_ASSERTIONS: PostingAssertions = {
  kind: 'month_end_inventory',
  before: {
    balances: {
      inventory_raw_materials: 12_040_000,
      inventory_wip: 0,
      inventory_finished_goods: 8_810_000,
    },
    activityTotals: {
      absorbedLabor: 1_890_000,
      absorbedOverhead: 1_204_000,
      inventoryAdjustments: -84_000,
    },
  },
  after: {
    balances: {
      inventory_raw_materials: 12_862_000,
      inventory_wip: 0,
      inventory_finished_goods: 8_509_000,
    },
    activityTotals: {
      absorbedLabor: 2_302_000,
      absorbedOverhead: 1_472_000,
      inventoryAdjustments: -115_000,
    },
  },
}

/** What `ledger.get(id)` would return for a posted month. */
export const FIXTURE_POSTED_DRAFT: PostingDraftV1 = {
  v: 1,
  docNumber: 'AUXX-MEI-2027-02',
  revision: 2,
  memo: 'Re-entry after the February shrinkage correction.',
  entry: {
    postingType: 'month_end_inventory',
    periodKey: '2027-02',
    txnDate: '2027-02-28',
    lines: [],
    totalDebit: 620_400,
    totalCredit: 620_400,
  },
  resolvedLines: FIXTURE_PREVIEW_LINES,
  assertions: FIXTURE_ASSERTIONS,
}

export const FIXTURE_POST_RESULT: PostResult = {
  status: 'posted',
  glPostingId: 'glp_2027_03_r0',
  docNumber: 'AUXX-MEI-2027-03',
  providerId: 'quickbooks',
  providerEntryId: '184',
}

/** ⚠️ A first-class outcome, never an error — decision `P1`. */
export const FIXTURE_POST_RESULT_NOT_CONNECTED: PostResult = {
  status: 'not_connected',
  glPostingId: 'glp_2027_03_r0',
  docNumber: 'AUXX-MEI-2027-03',
}

export const FIXTURE_UNPOSTED_PERIODS: UnpostedPeriod[] = [
  {
    periodKey: '2027-03',
    postingType: 'month_end_inventory',
    glPostingId: 'glp_2027_03_r0',
    status: 'failed',
    docNumber: 'AUXX-MEI-2027-03',
    attempts: 2,
    failureReason: 'QuickBooks refused the entry: account 5020 is inactive.',
  },
]

export const FIXTURE_BOOKS_BALANCE: BooksBalanceReport = {
  balanced: true,
  postingsChecked: 4,
  discrepancies: [],
}

// ── Evidence sections ───────────────────────────────────────────────────────

/** One `G12` count adjustment, as the cycle-count evidence table renders it. */
export interface FixtureCountAdjustment {
  movementId: string
  partNumber: string
  partName: string
  systemQuantity: number
  countedQuantity: number
  delta: number
  /** Frozen standard cost at the time of the adjustment, minor units. */
  unitCostMinor: number
  extendedCostMinor: number
  reason: string
  actorName: string
  occurredAt: string
}

export const FIXTURE_COUNT_ADJUSTMENTS: FixtureCountAdjustment[] = [
  {
    movementId: 'sm_a1',
    partNumber: 'HYD-4410',
    partName: 'Hydraulic cylinder, 4in bore',
    systemQuantity: 48,
    countedQuantity: 44,
    delta: -4,
    unitCostMinor: 6_250_0,
    extendedCostMinor: -250_000,
    reason: 'Cycle count — March',
    actorName: 'Dana Whitfield',
    occurredAt: '2027-03-18T15:10:00.000Z',
  },
  {
    movementId: 'sm_a2',
    partNumber: 'FRM-2201',
    partName: 'Mast frame weldment',
    systemQuantity: 12,
    countedQuantity: 13,
    delta: 1,
    unitCostMinor: 4_100_0,
    extendedCostMinor: 41_000,
    reason: 'Cycle count — March',
    actorName: 'Dana Whitfield',
    occurredAt: '2027-03-18T15:24:00.000Z',
  },
  {
    movementId: 'sm_a3',
    partNumber: 'CTL-0090',
    partName: 'Control harness',
    systemQuantity: 30,
    countedQuantity: 28,
    delta: -2,
    unitCostMinor: 1_010_0,
    extendedCostMinor: -20_200,
    reason: 'Damaged in handling',
    actorName: 'Miguel Ortiz',
    occurredAt: '2027-03-24T11:02:00.000Z',
  },
]

/**
 * Activity dated before this period but entered after the prior close.
 *
 * 🛑 The section that keeps the number explainable. Task 09's legs are CUMULATIVE
 * deltas, so a build or adjustment dated in a closed month but entered after that
 * close lands in the next OPEN month's delta. Without this on screen, March's
 * entry containing February activity reads as a bug.
 *
 * `createdAt` says when auxx LEARNED about the row — audit evidence, never its
 * accounting date.
 */
export interface FixtureLateArrival {
  id: string
  kind: 'build' | 'adjustment' | 'receipt'
  reference: string
  description: string
  /** The accounting date — what decides which period it belongs to. */
  occurredAt: string
  /** When auxx learned about it. */
  createdAt: string
  amountMinor: number
}

export const FIXTURE_LATE_ARRIVALS: FixtureLateArrival[] = [
  {
    id: 'bld_0219',
    kind: 'build',
    reference: 'BLD-0219',
    description: 'Backdated February build entered on March 4',
    occurredAt: '2027-02-26T00:00:00.000Z',
    createdAt: '2027-03-04T13:47:00.000Z',
    amountMinor: 214_000,
  },
  {
    id: 'sm_a0',
    kind: 'adjustment',
    reference: 'ADJ-0088',
    description: 'February shrinkage recorded after the February close',
    occurredAt: '2027-02-27T00:00:00.000Z',
    createdAt: '2027-03-06T09:15:00.000Z',
    amountMinor: -31_000,
  },
]

/**
 * What sits behind one line of the entry.
 *
 * ⚠️ NOT stored provenance. `GlPostingLineInput` carries ONE `sourceType` +
 * `sourceId` per line, and a month-end line summarises hundreds of movements —
 * so the real version of this is a query back into the subledger, a report
 * rather than an expander. Gap-g §3's "click 4000 and see the 41 order ids" is
 * not backed by the shipped data.
 */
export interface FixtureDrillDownRow {
  id: string
  reference: string
  description: string
  occurredAt: string
  quantity: number
  unitCostMinor: number
  extendedCostMinor: number
}

export const FIXTURE_DRILL_DOWN: Record<string, FixtureDrillDownRow[]> = {
  '1310': [
    {
      id: 'sm_r1',
      reference: 'RCV-1204',
      description: 'Received against PO-0455',
      occurredAt: '2027-03-06T00:00:00.000Z',
      quantity: 40,
      unitCostMinor: 6_250_0,
      extendedCostMinor: 2_500_000,
    },
    {
      id: 'sm_r2',
      reference: 'BLD-0221',
      description: 'Consumed by build',
      occurredAt: '2027-03-14T00:00:00.000Z',
      quantity: -22,
      unitCostMinor: 6_250_0,
      extendedCostMinor: -1_375_000,
    },
  ],
  '2110': [
    {
      id: 'bld_0221',
      reference: 'BLD-0221',
      description: 'Absorbed assembly labor',
      occurredAt: '2027-03-14T00:00:00.000Z',
      quantity: 8,
      unitCostMinor: 51_500,
      extendedCostMinor: 412_000,
    },
  ],
}

/** Parts with no standard cost — what `settings/general`'s costing section lists. */
export interface FixtureUnrolledPart {
  partId: string
  partNumber: string
  name: string
  reason: 'no-live-cost' | 'no-bill-of-materials'
}

export const FIXTURE_UNROLLED_PARTS: FixtureUnrolledPart[] = [
  {
    partId: 'prt_1',
    partNumber: 'ASM-7700',
    name: 'Lift assembly, 7700 series',
    reason: 'no-bill-of-materials',
  },
  {
    partId: 'prt_2',
    partNumber: 'HYD-4415',
    name: 'Hydraulic cylinder, 5in bore',
    reason: 'no-live-cost',
  },
]

/** Whether a provider is connected at all. `not_connected` is FIRST-CLASS (`P1`). */
export const FIXTURE_PROVIDER = {
  id: 'quickbooks' as const,
  label: 'QuickBooks Online',
  connected: true,
  realmId: '4620816365320394982',
}

/** Deep link into the provider's own register, so reconciliation is not copy-paste. */
export function fixtureProviderEntryUrl(providerEntryId: string): string {
  return `https://app.qbo.intuit.com/app/journal?txnId=${providerEntryId}`
}
