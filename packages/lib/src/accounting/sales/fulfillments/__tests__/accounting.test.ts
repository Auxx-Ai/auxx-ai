// packages/lib/src/accounting/sales/fulfillments/__tests__/accounting.test.ts
//
// The shipment poster's frame (88 §4.5) and its own facts (91 D2): the claim,
// the gates, the work item, and an entry that reads no receipt and no sibling box.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getOrganizationSetting: vi.fn(),
  isAccountingActive: vi.fn(async () => true),
  findLiveSubjectPosting: vi.fn(),
  readFulfillmentPostingSubject: vi.fn(),
  readOrderForFulfillment: vi.fn(),
  readOrderSourceScope: vi.fn(async () => ({ store: 'store_1' })),
  postEntry: vi.fn(),
  resolvePeriodLock: vi.fn(async () => ({})),
  /** Every work-item write, park or clear (91 §4.6). */
  setValues: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingActive: h.isAccountingActive,
}))
vi.mock('../../../ledger/setup/setup-readiness', () => ({ FINALIZED_SETUP_STATE: 'finalized' }))
vi.mock('../../../ledger/post/post-entry', () => ({
  postEntry: h.postEntry,
  LEDGER_CURRENCY: 'USD',
}))
vi.mock('../../../ledger/reads/list-postings', () => ({
  findLiveSubjectPosting: h.findLiveSubjectPosting,
}))
vi.mock('../../../ledger/periods/period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))
vi.mock('../../../../settings/read', () => ({
  readOrganizationSettings: async (organizationId: string, keys: readonly string[]) =>
    Object.fromEntries(
      await Promise.all(
        keys.map(async (key) => [key, await h.getOrganizationSetting({ organizationId, key })])
      )
    ),
}))
vi.mock('../reads', () => ({ readFulfillmentPostingSubject: h.readFulfillmentPostingSubject }))
vi.mock('../../orders/reads', () => ({ readOrderForFulfillment: h.readOrderForFulfillment }))
// Only the store scope: the poster reads no receipt, coverage or timeline (91 D2).
vi.mock('../../../money/customer-money/reads', () => ({
  readOrderSourceScope: h.readOrderSourceScope,
}))
vi.mock('../../../work-items/write', () => ({
  upsertWorkItem: async (_db: unknown, _org: string, input: Record<string, unknown>) =>
    h.setValues.push({ park: input }),
  deleteWorkItem: async (_db: unknown, _org: string, key: Record<string, unknown>) =>
    h.setValues.push({ clear: key }),
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import type { OrderForFulfillment } from '../../orders/reads'
import {
  postFulfillmentAccounting,
  prepareShipmentEntry,
  readShipmentPostingWindow,
} from '../accounting'

const organizationId = 'org_1'
const fulfillmentId = 'ful_1'
const KEY = { sourceKind: 'fulfillment', sourceId: fulfillmentId, stage: 'post' }
const CLEARED = [{ clear: KEY }]

/** `role:direction -> amount`, one key per line. */
function byRole(entry: { lines: { accountRole?: string; direction: string; amount: number }[] }) {
  return Object.fromEntries(
    entry.lines.map((line) => [`${line.accountRole}:${line.direction}`, line.amount])
  )
}

function db(): Database {
  return {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}),
  } as unknown as Database
}

/** One order, one shipment of it, both stamped and consistent. */
function order(overrides: Record<string, unknown> = {}) {
  return ok({
    orderId: 'ord_1',
    recordId: 'def_order:ord_1',
    number: 'ORD-1',
    channel: 'dtc',
    currency: 'USD',
    subtotalMinor: 10000,
    taxTotalMinor: 800,
    shippingTotalMinor: 0,
    totalMinor: 10800,
    fulfillmentStatus: 'fulfilled',
    fulfillments: [
      {
        id: fulfillmentId,
        recordId: 'def_fulfillment:ful_1',
        orderId: 'ord_1',
        sequence: 1,
        shippedAt: '2026-09-02T10:00:00.000Z',
        status: 'success',
        cancelledAt: null,
        name: 'ORD-1-F1',
        trackingNumber: null,
        trackingCompany: null,
        trackingUrl: null,
        subtotalMinor: 10000,
        totalMinor: 10800,
        shippingRecognised: false,
        glPosting: null,
        docNumber: null,
        recordedAt: '2026-09-02T10:00:00.000Z',
        lines: [
          { id: 'fl_1', recordId: 'x', lineItemId: 'li_1', quantity: 1, quantityRelieved: 1 },
        ],
      },
    ],
    lines: [
      {
        lineId: 'li_1',
        name: 'Widget',
        quantity: 1,
        shippedQuantity: 1,
        remainingQuantity: 0,
        unitPriceMinor: 10000,
        lineTotalMinor: 10000,
        lineTaxMinor: null,
      },
    ],
    nextSequence: 2,
    shippingOwed: false,
    contactInstanceId: 'contact_1',
    taxLines: [],
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.setValues = []
  h.getOrganizationSetting.mockImplementation(async ({ key }: { key: string }) =>
    key === 'accounting.setupState' ? 'finalized' : key === 'accounting.bookTimeZone' ? 'UTC' : null
  )
  h.isAccountingActive.mockResolvedValue(true)
  h.findLiveSubjectPosting.mockResolvedValue(ok(null))
  h.readFulfillmentPostingSubject.mockResolvedValue({ orderId: 'ord_1', subtotalMinor: 10000 })
  h.readOrderForFulfillment.mockResolvedValue(order())
  h.readOrderSourceScope.mockResolvedValue({ store: 'store_1' })
  h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'glp_1' })
})

describe('postFulfillmentAccounting', () => {
  it('answers accepted off a live subject claim without rebuilding anything', async () => {
    h.findLiveSubjectPosting.mockResolvedValue(ok({ id: 'glp_live' }))
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toEqual({ status: 'accepted', glPostingId: 'glp_live' })
    expect(h.postEntry).not.toHaveBeenCalled()
    // The marker clears on acceptance.
    expect(h.setValues).toEqual(CLEARED)
  })

  it('skips an org with accounting off', async () => {
    h.isAccountingActive.mockResolvedValue(false)
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toEqual({ status: 'skipped', reason: 'Accounting is not enabled' })
  })

  it('skips a draft org silently: no posting, no work item (110 G3)', async () => {
    h.isAccountingActive.mockResolvedValue(false)
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toEqual({ status: 'skipped', reason: 'Accounting is not enabled' })
    expect(h.postEntry).not.toHaveBeenCalled()
    expect(h.setValues).toEqual([])
  })

  it('skips a cancelled shipment as a visible skip the sweep never re-offers', async () => {
    const read = order()
    read._unsafeUnwrap().fulfillments[0]!.status = 'cancelled'
    h.readOrderForFulfillment.mockResolvedValue(read)
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toEqual({
      status: 'skipped',
      reason: 'Shipment is cancelled, so there is nothing to recognise',
    })
    expect(h.setValues).toEqual([{ park: { ...KEY, reasonCode: 'NOTHING_TO_RECOGNISE' } }])
  })

  it('blocks an unstamped shipment with the stamp as the reason', async () => {
    h.readFulfillmentPostingSubject.mockResolvedValue({ orderId: 'ord_1', subtotalMinor: null })
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toEqual({
      status: 'blocked',
      reason: 'Shipment totals are not stamped yet',
    })
    // The code the totals stamp wakes (91 §4.6).
    expect(h.setValues).toEqual([{ park: { ...KEY, reasonCode: 'TOTALS_NOT_STAMPED' } }])
  })

  it('skips a $0 shipment', async () => {
    const read = order()
    const fulfillment = read._unsafeUnwrap().fulfillments[0]!
    fulfillment.subtotalMinor = 0
    fulfillment.totalMinor = 0
    h.readFulfillmentPostingSubject.mockResolvedValue({ orderId: 'ord_1', subtotalMinor: 0 })
    h.readOrderForFulfillment.mockResolvedValue(read)
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result.status).toBe('skipped')
  })

  it('blocks a shipment dated in or before the opening cutoff', async () => {
    h.getOrganizationSetting.mockImplementation(async ({ key }: { key: string }) =>
      key === 'accounting.setupState'
        ? 'finalized'
        : key === 'accounting.bookTimeZone'
          ? 'UTC'
          : '2026-09'
    )
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toEqual({
      status: 'blocked',
      reason: 'Shipment is before the accounting opening cutoff 2026-09',
    })
  })

  // 91 §2: Dr A/R 108 / Cr Revenue 100, Cr Sales tax 8 - with no receipt anywhere on the order.
  it('posts Dr A/R / Cr revenue, Cr tax off its own totals, with no receipt on the order', async () => {
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toEqual({ status: 'accepted', glPostingId: 'glp_1' })
    const call = h.postEntry.mock.calls[0]![1]
    expect(byRole(call.entry)).toEqual({
      'accounts_receivable:debit': 10800,
      'revenue_product:credit': 10000,
      'sales_tax_payable:credit': 800,
    })
    // A/R resolves on the store axis through the entry scope (91 §4.3).
    expect(call.scope).toEqual({ store: 'store_1' })
    expect(call.storeId).toBe('store_1')
    expect(call.railId).toBeNull()
    expect(h.setValues).toEqual(CLEARED)
  })

  it('posts a second box off its own stamp, never reading the first box', async () => {
    const read = order({ subtotalMinor: 10000, taxTotalMinor: 800, totalMinor: 10800 })
    const base = read._unsafeUnwrap()
    const first = base.fulfillments[0]!
    base.fulfillments = [
      { ...first, id: 'ful_0', subtotalMinor: 4000, totalMinor: 4320 },
      {
        ...first,
        id: 'ful_1',
        sequence: 2,
        subtotalMinor: 6000,
        totalMinor: 6480,
        lines: [{ ...first.lines[0]!, id: 'fl_2', lineItemId: 'li_2' }],
      },
    ]
    base.fulfillments[0]!.lines = [{ ...first.lines[0]!, lineItemId: 'li_1' }]
    base.lines = [
      { ...base.lines[0]!, lineId: 'li_1', unitPriceMinor: 4000, lineTotalMinor: 4000 },
      { ...base.lines[0]!, lineId: 'li_2', unitPriceMinor: 6000, lineTotalMinor: 6000 },
    ]
    h.readOrderForFulfillment.mockResolvedValue(read)
    h.readFulfillmentPostingSubject.mockResolvedValue({ orderId: 'ord_1', subtotalMinor: 6000 })

    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result.status).toBe('accepted')
    // Only this box's own claim is looked up; the first box's posting is never read.
    expect(h.findLiveSubjectPosting).toHaveBeenCalledTimes(1)
    expect(h.findLiveSubjectPosting.mock.calls[0]![1]).toMatchObject({ sourceId: 'ful_1' })
    // Cumulative tax: round(800 x 10000/10000) - round(800 x 4000/10000) = 480.
    expect(byRole(h.postEntry.mock.calls[0]![1].entry)).toEqual({
      'accounts_receivable:debit': 6480,
      'revenue_product:credit': 6000,
      'sales_tax_payable:credit': 480,
    })
  })

  it('parks the ledger refusal as a coded work item', async () => {
    h.postEntry.mockResolvedValue({ status: 'error', error: 'Cannot post: revenue_product' })
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toEqual({ status: 'blocked', reason: 'Cannot post: revenue_product' })
    expect(h.setValues).toEqual([
      {
        park: {
          ...KEY,
          reasonCode: 'TRANSIENT_ERROR',
          detail: { message: 'Cannot post: revenue_product' },
        },
      },
    ])
  })
})

describe('the shared core (88 D6)', () => {
  it('builds the preview off a shipment no record carries, under the preview id', async () => {
    const read = order()
    const base = read._unsafeUnwrap()
    const prepared = await prepareShipmentEntry({} as never, {
      organizationId,
      order: { ...base, fulfillments: [] } as unknown as OrderForFulfillment,
      window: await readShipmentPostingWindow(organizationId),
      shipment: {
        id: 'preview',
        sequence: 1,
        shippedAt: '2026-09-05T12:00:00.000Z',
        lines: [
          {
            lineId: 'li_1',
            quantity: 1,
            unitPriceMinor: 10000,
            lineTotalMinor: 10000,
            orderedQuantity: 1,
            priorShippedQuantity: 0,
            listLineTotalMinor: null,
            giftCard: false,
            name: 'Widget',
          },
        ],
        priorSubtotalMinor: 0,
        includeShipping: false,
        subtotalMinor: 10000,
        taxMinor: 800,
        shippingMinor: 0,
        totalMinor: 10800,
      },
    })
    expect(prepared.sources[0]).toEqual({
      sourceKind: 'fulfillment',
      sourceId: 'preview',
      linkRole: 'subject',
    })
    expect(prepared.entry.txnDate).toBe('2026-09-05')
    expect(byRole(prepared.entry)).toEqual({
      'accounts_receivable:debit': 10800,
      'revenue_product:credit': 10000,
      'sales_tax_payable:credit': 800,
    })
  })
})
