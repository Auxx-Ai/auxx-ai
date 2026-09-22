// packages/lib/src/accounting/sales/fulfillments/__tests__/accounting.test.ts
//
// The shipment poster's frame (88 §4.5): the claim, the draft, the gates, the
// timeline, and the marker the sweep backs off on.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getOrganizationSetting: vi.fn(),
  isAccountingEnabled: vi.fn(async () => true),
  findLiveSubjectPosting: vi.fn(),
  findLiveFulfillmentDraft: vi.fn(async () => null as string | null),
  readFulfillmentPostingSubject: vi.fn(),
  readOrderForFulfillment: vi.fn(),
  readOrderRecognitionFactsInTx: vi.fn(),
  readOrderMoneyCoverage: vi.fn(),
  readOrderRecognitionSource: vi.fn(),
  readOrderSourceScope: vi.fn(async () => ({ store: 'store_1' })),
  postEntry: vi.fn(),
  resolvePeriodLock: vi.fn(async () => ({})),
  readAutoPostMode: vi.fn(async () => 'post'),
  /** Every work-item write, park or clear (91 §4.6). */
  setValues: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../ledger/setup/setup-readiness', () => ({ FINALIZED_SETUP_STATE: 'finalized' }))
vi.mock('../../../ledger/post/auto-post', () => ({ readAutoPostMode: h.readAutoPostMode }))
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
vi.mock('../posting-reads', () => ({ findLiveFulfillmentDraft: h.findLiveFulfillmentDraft }))
vi.mock('../reads', () => ({ readFulfillmentPostingSubject: h.readFulfillmentPostingSubject }))
vi.mock('../../orders/reads', () => ({ readOrderForFulfillment: h.readOrderForFulfillment }))
vi.mock('../../../money/customer-money/recognition-facts', () => ({
  readOrderRecognitionFactsInTx: h.readOrderRecognitionFactsInTx,
}))
vi.mock('../../../money/customer-money/reads', () => ({
  readOrderMoneyCoverage: h.readOrderMoneyCoverage,
  readOrderSourceScope: h.readOrderSourceScope,
}))
vi.mock('../../../money/customer-money/recognition-source', () => ({
  readOrderRecognitionSource: h.readOrderRecognitionSource,
  requireCompleteOrderRecognitionSource: (value: { blockers: string[] }) => {
    if (value.blockers.length) throw new Error('unreachable in this harness')
    return value
  },
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
  PREVIEW_SHIPMENT_ID,
  postFulfillmentAccounting,
  prepareShipmentEntry,
  readShipmentPostingWindow,
} from '../accounting'

const organizationId = 'org_1'
const fulfillmentId = 'ful_1'
const KEY = { sourceKind: 'fulfillment', sourceId: fulfillmentId, stage: 'post' }
const CLEARED = [{ clear: KEY }]

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
  h.isAccountingEnabled.mockResolvedValue(true)
  h.findLiveSubjectPosting.mockResolvedValue(ok(null))
  h.findLiveFulfillmentDraft.mockResolvedValue(null)
  h.readFulfillmentPostingSubject.mockResolvedValue({ orderId: 'ord_1', subtotalMinor: 10000 })
  h.readOrderForFulfillment.mockResolvedValue(order())
  h.readOrderRecognitionFactsInTx.mockResolvedValue({
    subtotal: 10000n,
    shipping: 0n,
    tax: 800n,
    customerInstanceId: 'contact_1',
    taxComponents: [],
  })
  h.readOrderMoneyCoverage.mockResolvedValue({ sourceAvailable: true })
  h.readOrderRecognitionSource.mockResolvedValue({
    blockers: [],
    target: {
      id: fulfillmentId,
      kind: 'fulfillment',
      effectiveDate: '2026-09-02',
      amountMinor: '10800',
      depositMinor: '10000',
      receivableMinor: '800',
      taxMinor: '800',
      historyHash: 'a'.repeat(64),
    },
    targetTaxComponents: [],
  })
  h.readOrderSourceScope.mockResolvedValue({ store: 'store_1' })
  h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'glp_1' })
  h.readAutoPostMode.mockResolvedValue('post')
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

  it('answers drafted off a pending link onto a draft', async () => {
    h.findLiveFulfillmentDraft.mockResolvedValue('glp_draft')
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toEqual({ status: 'drafted', glPostingId: 'glp_draft' })
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('skips an org with accounting off', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toEqual({ status: 'skipped', reason: 'Accounting is not enabled' })
  })

  it('blocks, and parks, an org whose setup is not finalized', async () => {
    h.getOrganizationSetting.mockImplementation(async ({ key }: { key: string }) =>
      key === 'accounting.bookTimeZone' ? 'UTC' : null
    )
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result.status).toBe('blocked')
    expect((result as { reason: string }).reason).toContain('Finalize accounting setup')
    expect(h.setValues).toEqual([{ park: { ...KEY, reasonCode: 'SETUP_INCOMPLETE' } }])
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

  it('posts the allocation as the recognition split, and clears the marker', async () => {
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toEqual({ status: 'accepted', glPostingId: 'glp_1' })
    const entry = h.postEntry.mock.calls[0]![1].entry
    const byRole = Object.fromEntries(
      entry.lines.map((line: { accountRole?: string; direction: string; amount: number }) => [
        `${line.accountRole}:${line.direction}`,
        line.amount,
      ])
    )
    expect(byRole['customer_deposits:debit']).toBe(10000)
    expect(byRole['accounts_receivable:debit']).toBe(800)
    expect(byRole['revenue_product:credit']).toBe(10000)
    expect(h.postEntry.mock.calls[0]![1].railId).toBeNull()
    expect(h.setValues).toEqual(CLEARED)
  })

  it('debits A/R in full on an order with no connected source, never reading the timeline', async () => {
    h.readOrderMoneyCoverage.mockResolvedValue({ sourceAvailable: false })
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result.status).toBe('accepted')
    expect(h.readOrderRecognitionSource).not.toHaveBeenCalled()
    const entry = h.postEntry.mock.calls[0]![1].entry
    const receivable = entry.lines.find(
      (line: { accountRole?: string; direction: string }) =>
        line.accountRole === 'accounts_receivable' && line.direction === 'debit'
    )
    expect(receivable.amount).toBe(10800)
    expect(
      entry.lines.some((line: { accountRole?: string }) => line.accountRole === 'customer_deposits')
    ).toBe(false)
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

  it('clears the marker on a draft - a draft is not a refusal', async () => {
    h.postEntry.mockResolvedValue({ status: 'drafted', glPostingId: 'glp_draft' })
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toEqual({ status: 'drafted', glPostingId: 'glp_draft' })
    expect(h.setValues).toEqual(CLEARED)
  })
})

describe('the shared core (88 D6)', () => {
  it('hands the timeline the shipment as the walk computed it, keyed on the record', async () => {
    await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    const asked = h.readOrderRecognitionSource.mock.calls[0]![1]
    expect(asked.target).toEqual({ kind: 'fulfillment', id: fulfillmentId })
    expect(asked.targetEvent).toEqual({
      id: fulfillmentId,
      kind: 'fulfillment',
      effectiveDate: '2026-09-02',
      occurredAt: '2026-09-02T10:00:00.000Z',
      netMinor: '10000',
      taxMinor: '800',
    })
  })

  it('builds the preview off a shipment no record carries, under the preview id', async () => {
    const read = order()
    const base = read._unsafeUnwrap()
    h.readOrderRecognitionSource.mockResolvedValue({
      blockers: [],
      target: {
        id: PREVIEW_SHIPMENT_ID,
        kind: 'fulfillment',
        effectiveDate: '2026-09-05',
        amountMinor: '10800',
        depositMinor: '10000',
        receivableMinor: '800',
        taxMinor: '800',
        historyHash: 'a'.repeat(64),
      },
      targetTaxComponents: [],
    })
    const prepared = await prepareShipmentEntry({} as never, {
      organizationId,
      order: { ...base, fulfillments: [] } as unknown as OrderForFulfillment,
      window: await readShipmentPostingWindow(organizationId),
      shipment: {
        id: PREVIEW_SHIPMENT_ID,
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
    const asked = h.readOrderRecognitionSource.mock.calls[0]![1]
    expect(asked.target).toEqual({ kind: 'fulfillment', id: PREVIEW_SHIPMENT_ID })
    expect(asked.targetEvent).toMatchObject({ id: PREVIEW_SHIPMENT_ID, netMinor: '10000' })
    expect(prepared.sources[0]).toEqual({
      sourceKind: 'fulfillment',
      sourceId: PREVIEW_SHIPMENT_ID,
      linkRole: 'subject',
    })
    expect(prepared.entry.txnDate).toBe('2026-09-05')
    expect(
      prepared.entry.lines.find(
        (line: { accountRole?: string; direction: string }) =>
          line.accountRole === 'customer_deposits' && line.direction === 'debit'
      )?.amount
    ).toBe(10000)
  })
})
