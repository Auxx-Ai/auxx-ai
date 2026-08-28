// packages/lib/src/purchasing/__tests__/aging-sweep.test.ts
//
// P24's aging rule was implemented and then never fired on its own:
// `awaiting_receipt` -> `exception` was computed only when a bill line was edited
// or a receipt landed, so a bill whose goods NEVER arrive stayed amber forever —
// the one failure mode that made the simpler design unacceptable.
//
// These tests pin the SELECTION, which is all this module decides. The verdict
// itself belongs to `matchBill` (`match.test.ts`) and the write to `rematchBill`
// (`match-hook.test.ts`, which already covers awaiting -> exception once overdue);
// `rematchBill` is mocked here precisely so a divergence would show up as a
// selection bug rather than being masked by a second copy of the verdict.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** FIFO of results for each `database.select(...)....where(...)` in the run. */
  dbResults: [] as unknown[][],
  bySystemAttributes: vi.fn(),
  readFieldRelations: vi.fn(),
  readFieldScalars: vi.fn(),
  rematchBill: vi.fn(),
  getSystemUserForActions: vi.fn(),
}))

/**
 * `.from()` / `.innerJoin()` chain, `.where()` resolves the next queued result —
 * the two query shapes this module issues (the global joined scan and the per-org
 * bill-lines lookup) both terminate at `.where()`.
 */
function chain(): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  c.from = () => c
  c.innerJoin = () => c
  c.where = () => Promise.resolve(h.dbResults.shift() ?? [])
  return c
}

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  const base = createChainableDatabaseMock()
  return {
    // Only `select` is pinned; everything else keeps the chainable stand-in so an
    // import-graph edge that prepares a statement at module scope still loads.
    database: new Proxy(base, {
      get: (target, prop) => (prop === 'select' ? () => chain() : Reflect.get(target, prop)),
    }),
    schema: createSchemaMock(),
  }
})

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))

vi.mock('../../field-values/read-field-scalars', () => ({
  readFieldRelations: h.readFieldRelations,
  readFieldScalars: h.readFieldScalars,
}))

vi.mock('../match-hook', () => ({ rematchBill: h.rematchBill }))

vi.mock('../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: h.getSystemUserForActions },
}))

import { sweepAgingVendorBills } from '../aging-sweep'

const FIELDS: Record<string, { id: string }> = {
  vendor_bill_line_vendor_bill: { id: 'f-bl-bill' },
  vendor_bill_line_purchase_order_line: { id: 'f-bl-pol' },
  purchase_order_line_purchase_order: { id: 'f-pol-po' },
  purchase_order_expected_at: { id: 'f-po-expected' },
}

const ORG = 'org-1'
const USER = 'system-user-1'
const NOW = new Date('2026-08-28T12:00:00.000Z')
const DAY = 86_400_000

/** `expectedAt` that many days before {@link NOW}, as the ISO STRING the column returns. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString()
}

/** `instanceId -> fieldId -> relatedId`, the shape `readFieldRelations` returns. */
type Relations = Record<string, Record<string, string>>

function toRelationMap(relations: Relations): Map<string, Map<string, string>> {
  return new Map(
    Object.entries(relations).map(([id, fields]) => [id, new Map(Object.entries(fields))])
  )
}

/**
 * One organization's world: which bill lines belong to which bill, which PO line
 * each charges, which order that line sits on, and when that order was expected.
 */
function fixture(params: {
  /** `billInstanceId -> lineInstanceIds` */
  bills: Record<string, string[]>
  /** `lineInstanceId -> poLineInstanceId` */
  poLines: Record<string, string>
  /** `poLineInstanceId -> orderInstanceId` */
  orders: Record<string, string>
  /** `orderInstanceId -> expectedAt` (absent = the order carries no date) */
  expectedAt: Record<string, string>
}) {
  const lineRows = Object.entries(params.bills).flatMap(([billId, lineIds]) =>
    lineIds.map((lineInstanceId) => ({ lineInstanceId, vendorBillInstanceId: billId }))
  )
  h.dbResults.push(lineRows)

  const lineRelations: Relations = {}
  for (const [lineId, poLineId] of Object.entries(params.poLines)) {
    lineRelations[lineId] = { 'f-bl-pol': poLineId }
  }
  const poLineRelations: Relations = {}
  for (const [poLineId, orderId] of Object.entries(params.orders)) {
    poLineRelations[poLineId] = { 'f-pol-po': orderId }
  }
  const scalars = new Map(
    Object.entries(params.expectedAt).map(([orderId, value]) => [
      orderId,
      new Map<string, unknown>([['f-po-expected', value]]),
    ])
  )

  h.readFieldRelations.mockImplementation(
    async (_db: unknown, _org: string, _ids: string[], fieldIds: string[]) =>
      fieldIds.includes('f-bl-pol') ? toRelationMap(lineRelations) : toRelationMap(poLineRelations)
  )
  h.readFieldScalars.mockResolvedValue(scalars)
}

/** The one-line-one-order case, with the order expected `days` ago. */
function oneBillExpected(days: number | null) {
  h.dbResults.push([{ organizationId: ORG, vendorBillInstanceId: 'bill-1' }])
  fixture({
    bills: { 'bill-1': ['line-1'] },
    poLines: { 'line-1': 'pol-1' },
    orders: { 'pol-1': 'order-1' },
    expectedAt: days === null ? {} : { 'order-1': daysAgo(days) },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.dbResults = []
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(attrs.filter((a) => FIELDS[a]).map((a) => [a, FIELDS[a]]))
  )
  h.getSystemUserForActions.mockResolvedValue(USER)
  h.rematchBill.mockResolvedValue(undefined)
})

describe('sweepAgingVendorBills', () => {
  it('leaves a bill alone while it is still inside its grace period', async () => {
    // Expected three days ago, grace is seven — early, not late. This is the case
    // the whole of P24 exists to protect: prepayment is the normal state of a
    // CORRECT bill here for weeks, and a sweep that touched this one would put the
    // false positives straight back.
    oneBillExpected(3)

    const summary = await sweepAgingVendorBills(NOW)

    expect(h.rematchBill).not.toHaveBeenCalled()
    expect(summary).toEqual({ organizations: 1, candidates: 1, rematched: 0, failures: 0 })
  })

  it('re-matches a bill that has just crossed the grace boundary', async () => {
    oneBillExpected(8)

    const summary = await sweepAgingVendorBills(NOW)

    expect(h.rematchBill).toHaveBeenCalledTimes(1)
    expect(h.rematchBill).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: 'bill-1',
    })
    expect(summary).toEqual({ organizations: 1, candidates: 1, rematched: 1, failures: 0 })
  })

  it('treats the instant the grace expires as still inside it, not past it', async () => {
    // `isReceiptOverdue` is strictly-past, the same forgiving direction the price
    // leg's `|difference| <= allowed` takes. Exactly seven days is not late.
    oneBillExpected(7)
    expect((await sweepAgingVendorBills(NOW)).rematched).toBe(0)

    h.dbResults = []
    vi.clearAllMocks()
    h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
      Object.fromEntries(attrs.filter((a) => FIELDS[a]).map((a) => [a, FIELDS[a]]))
    )
    h.getSystemUserForActions.mockResolvedValue(USER)
    oneBillExpected(7)
    // One millisecond past the boundary IS late.
    expect((await sweepAgingVendorBills(new Date(NOW.getTime() + 1))).rematched).toBe(1)
  })

  it('never ages a bill whose order carries no expected date', async () => {
    // The deliberate unsafe-LOOKING direction (P24): nobody agreed a date to be
    // late against, and `purchase_order_expected_at` is nullable with nothing
    // prefilling it, so the fallback would be the common case rather than the edge.
    oneBillExpected(null)

    expect((await sweepAgingVendorBills(NOW)).rematched).toBe(0)
    expect(h.rematchBill).not.toHaveBeenCalled()
  })

  it('re-matches a multi-line bill ONCE even when several of its orders are late', async () => {
    h.dbResults.push([{ organizationId: ORG, vendorBillInstanceId: 'bill-1' }])
    fixture({
      bills: { 'bill-1': ['line-1', 'line-2', 'line-3'] },
      poLines: { 'line-1': 'pol-1', 'line-2': 'pol-2', 'line-3': 'pol-3' },
      orders: { 'pol-1': 'order-1', 'pol-2': 'order-2', 'pol-3': 'order-1' },
      expectedAt: { 'order-1': daysAgo(30), 'order-2': daysAgo(20) },
    })

    await sweepAgingVendorBills(NOW)

    expect(h.rematchBill).toHaveBeenCalledTimes(1)
  })

  it('selects a bill as soon as ANY of its lines is late, not only when all are', async () => {
    h.dbResults.push([{ organizationId: ORG, vendorBillInstanceId: 'bill-1' }])
    fixture({
      bills: { 'bill-1': ['line-1', 'line-2'] },
      poLines: { 'line-1': 'pol-1', 'line-2': 'pol-2' },
      orders: { 'pol-1': 'order-early', 'pol-2': 'order-late' },
      expectedAt: { 'order-early': daysAgo(1), 'order-late': daysAgo(60) },
    })

    expect((await sweepAgingVendorBills(NOW)).rematched).toBe(1)
  })

  it('resolves the system user per organization and never re-matches as nobody', async () => {
    oneBillExpected(8)
    await sweepAgingVendorBills(NOW)
    expect(h.getSystemUserForActions).toHaveBeenCalledWith(ORG)
  })

  it('does not resolve a system user for an organization with nothing to age', async () => {
    // The system-user read is a query. An org whose prepaid bills are all still
    // early must cost the four scoped reads and nothing more.
    oneBillExpected(2)
    await sweepAgingVendorBills(NOW)
    expect(h.getSystemUserForActions).not.toHaveBeenCalled()
  })

  it('skips an organization missing a purchasing field instead of throwing', async () => {
    oneBillExpected(30)
    h.bySystemAttributes.mockResolvedValue({})

    const summary = await sweepAgingVendorBills(NOW)

    expect(h.rematchBill).not.toHaveBeenCalled()
    expect(summary.failures).toBe(0)
  })

  it('does nothing at all when no bill is awaiting a receipt', async () => {
    h.dbResults.push([])

    const summary = await sweepAgingVendorBills(NOW)

    expect(summary).toEqual({ organizations: 0, candidates: 0, rematched: 0, failures: 0 })
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
  })

  it("does not let one organization's failure abort the rest of the run", async () => {
    h.dbResults.push([
      { organizationId: 'org-broken', vendorBillInstanceId: 'bill-a' },
      { organizationId: 'org-ok', vendorBillInstanceId: 'bill-b' },
    ])
    // Only ONE bill-lines read is queued: the first org throws before it issues
    // its own, and the second must still find its rows rather than inheriting the
    // first org's — a sweep that ran the orgs off a shared cursor would.
    h.dbResults.push([{ lineInstanceId: 'line-b', vendorBillInstanceId: 'bill-b' }])
    h.bySystemAttributes.mockImplementation(async (attrs: string[]) => {
      if (h.bySystemAttributes.mock.calls.length === 1) throw new Error('cache exploded')
      return Object.fromEntries(attrs.filter((a) => FIELDS[a]).map((a) => [a, FIELDS[a]]))
    })
    h.readFieldRelations.mockImplementation(
      async (_db: unknown, _org: string, _ids: string[], fieldIds: string[]) =>
        fieldIds.includes('f-bl-pol')
          ? toRelationMap({ 'line-b': { 'f-bl-pol': 'pol-b' } })
          : toRelationMap({ 'pol-b': { 'f-pol-po': 'order-b' } })
    )
    h.readFieldScalars.mockResolvedValue(
      new Map([['order-b', new Map<string, unknown>([['f-po-expected', daysAgo(40)]])]])
    )

    const summary = await sweepAgingVendorBills(NOW)

    expect(h.rematchBill).toHaveBeenCalledTimes(1)
    expect(h.rematchBill).toHaveBeenCalledWith({
      organizationId: 'org-ok',
      userId: USER,
      vendorBillInstanceId: 'bill-b',
    })
    expect(summary).toEqual({ organizations: 2, candidates: 2, rematched: 1, failures: 1 })
  })

  it("does not let one bill's failure abort the others in the same organization", async () => {
    h.dbResults.push([
      { organizationId: ORG, vendorBillInstanceId: 'bill-1' },
      { organizationId: ORG, vendorBillInstanceId: 'bill-2' },
    ])
    fixture({
      bills: { 'bill-1': ['line-1'], 'bill-2': ['line-2'] },
      poLines: { 'line-1': 'pol-1', 'line-2': 'pol-2' },
      orders: { 'pol-1': 'order-1', 'pol-2': 'order-2' },
      expectedAt: { 'order-1': daysAgo(9), 'order-2': daysAgo(9) },
    })
    h.rematchBill.mockRejectedValueOnce(new Error('match exploded'))

    const summary = await sweepAgingVendorBills(NOW)

    expect(h.rematchBill).toHaveBeenCalledTimes(2)
    expect(summary).toEqual({ organizations: 1, candidates: 2, rematched: 1, failures: 1 })
  })

  it('ignores an unparseable expected date rather than calling the bill late off it', async () => {
    h.dbResults.push([{ organizationId: ORG, vendorBillInstanceId: 'bill-1' }])
    fixture({
      bills: { 'bill-1': ['line-1'] },
      poLines: { 'line-1': 'pol-1' },
      orders: { 'pol-1': 'order-1' },
      expectedAt: { 'order-1': 'not-a-date' },
    })

    expect((await sweepAgingVendorBills(NOW)).rematched).toBe(0)
  })

  it('leaves a bill alone when its lines charge no purchase order line', async () => {
    // A freight invoice or a one-off. Nothing to be late against.
    h.dbResults.push([{ organizationId: ORG, vendorBillInstanceId: 'bill-1' }])
    fixture({
      bills: { 'bill-1': ['line-1'] },
      poLines: {},
      orders: {},
      expectedAt: {},
    })

    expect((await sweepAgingVendorBills(NOW)).rematched).toBe(0)
    expect(h.rematchBill).not.toHaveBeenCalled()
  })
})
