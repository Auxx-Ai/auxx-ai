// packages/lib/src/field-hooks/pre/order-delete-guard.test.ts
// The guard that stops an order being hard-deleted out from under a fulfillment
// entry - one that stands in a settled month, and one that is simply still
// live.
//
// Modelled on `part-delete-guard.test.ts`. The settled predicates are the same
// three (`postings/settled-periods.ts`); what differs is the SUBJECT. A part is
// judged on its stock movements, an order on the general-ledger entries that
// name it, and those carry a calendar `txnDate` rather than a timestamp, which
// is what the timezone case below pins.
//
// 🛑 Two ways an order names an entry, and BOTH are read. A batch fulfillment
// entry summarises: only the A/R leg of a terms order carries
// `sourceType: 'order'`, so `listPostingsForSource` finds nothing at all for a
// paid Shopify order. The shipment log's stamp is the other half, and the
// `by the stamp alone` block below is the case a source-line-only guard misses
// entirely.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreDeleteEvent } from '../types'

const h = vi.hoisted(() => ({
  listPostingsForSource: vi.fn(),
  listOrderFulfillmentPostings: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postedPeriodRows: vi.fn(),
  /** The `GlPosting` rows the stamped ids resolve to: id + txnDate. */
  stampedPostingRows: vi.fn(),
  getOrganizationSetting: vi.fn(),
}))

vi.mock('../../postings/list-postings', () => ({
  listPostingsForSource: h.listPostingsForSource,
}))

vi.mock('../../money/fulfillment-posting/reads', () => ({
  listOrderFulfillmentPostings: h.listOrderFulfillmentPostings,
}))

vi.mock('../../postings/period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))
vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: h.getOrganizationSetting,
}))

// `selectDistinct()` is the posted-period read inside `settledPeriodsFor`, and
// `select()` is the guard's own read of the stamped postings' accounting dates.
// The terminal `.where()` resolves in both, so a query that stops ending there
// fails loudly.
vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/database')
  const postedChain: Record<string, unknown> = {}
  postedChain.from = () => postedChain
  postedChain.where = async () => h.postedPeriodRows()

  const stampedChain: Record<string, unknown> = {}
  stampedChain.from = () => stampedChain
  stampedChain.where = async () => h.stampedPostingRows()

  return {
    ...actual,
    database: { selectDistinct: () => postedChain, select: () => stampedChain },
  }
})

import { guardOrderDelete } from './order-delete-guard'

const ORDER_DEF = 'c62a43b54jinj532zfdlytc7'
const ORDER_ID = 'ou1drb01gv321lqe7pjnvkh8'
const ORDER_RECORD_ID = `${ORDER_DEF}:${ORDER_ID}`
const ORG = 'abgwpa1l81reht2zmwrcihfu'

function event(): EntityPreDeleteEvent {
  return {
    recordId: ORDER_RECORD_ID as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: ORDER_DEF,
    entityType: 'order',
    entitySlug: 'orders',
    values: {},
    organizationId: ORG,
    userId: 'usr_1',
    bypass: new Set(),
  }
}

/** A posting as `listPostingsForSource` summarises it, reduced to what the guard reads. */
function posting(txnDate: string, status: 'posted' | 'reversed' = 'posted') {
  return { id: `gl-${txnDate}-${status}`, txnDate, status, docNumber: 'FUL-0001' }
}

function postings(...rows: ReturnType<typeof posting>[]): void {
  h.listPostingsForSource.mockResolvedValue(ok(rows))
}

/** One posting the order's shipment log stamps, as the guard reads it. */
function stamp(
  glPostingId: string,
  txnDate: string,
  status: 'posted' | 'reversed' = 'posted',
  docNumber: string | null = `AUXX-FUL-${txnDate.replace(/-/g, '')}`
) {
  return { glPostingId, txnDate, status, docNumber }
}

/** Wire the log's stamps and the `GlPosting` rows they resolve to, together. */
function stamps(...rows: ReturnType<typeof stamp>[]): void {
  h.listOrderFulfillmentPostings.mockResolvedValue(
    ok(
      rows.map((row, index) => ({
        sequence: index + 1,
        shippedAt: row.txnDate,
        glPostingId: row.glPostingId,
        docNumber: row.docNumber,
        status: row.status,
      }))
    )
  )
  h.stampedPostingRows.mockReturnValue(
    rows.map((row) => ({ id: row.glPostingId, txnDate: row.txnDate }))
  )
}

function settings(values: Record<string, string | null>): void {
  h.getOrganizationSetting.mockImplementation(
    async ({ key }: { key: string }) => values[key] ?? null
  )
}

function posted(...periodKeys: string[]) {
  return periodKeys.map((periodKey) => ({ periodKey }))
}

const BOOKS_OPEN = {
  'accounting.cutoffPeriod': '2025-12',
  'accounting.bookTimeZone': 'America/Los_Angeles',
}

beforeEach(() => {
  vi.clearAllMocks()
  postings()
  stamps()
  h.postedPeriodRows.mockReturnValue([])
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  settings(BOOKS_OPEN)
})

describe('guardOrderDelete: refusal', () => {
  it('refuses an order whose entry sits in a month with a POSTED entry', async () => {
    postings(posting('2026-08-15'))
    h.postedPeriodRows.mockReturnValue(posted('2026-08'))

    await expect(guardOrderDelete(event())).rejects.toThrow(/2026-08/)
  })

  it('refuses an order whose entry sits in a LOCKED period with no posting at all', async () => {
    postings(posting('2026-06-15'))
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(guardOrderDelete(event())).rejects.toThrow(/closed or posted/)
  })

  it('refuses an entry AT OR BEFORE the cutoff, which never appears in the strip', async () => {
    postings(posting('2025-11-04'))

    await expect(guardOrderDelete(event())).rejects.toThrow(/2025-11/)
  })

  it('names every settled month and the total, not just the first', async () => {
    postings(posting('2026-07-02'), posting('2026-08-15'), posting('2026-08-16'))
    h.postedPeriodRows.mockReturnValue(posted('2026-07', '2026-08'))

    await expect(guardOrderDelete(event())).rejects.toThrow(/3 ledger postings in 2026-07, 2026-08/)
  })

  it('counts a REVERSED entry: a closed month still holds it and its reversal', async () => {
    postings(posting('2026-08-15', 'reversed'))
    h.postedPeriodRows.mockReturnValue(posted('2026-08'))

    await expect(guardOrderDelete(event())).rejects.toThrow(/1 ledger posting in 2026-08/)
  })

  it('points at archiving the order', async () => {
    postings(posting('2026-08-15'))
    h.postedPeriodRows.mockReturnValue(posted('2026-08'))

    await expect(guardOrderDelete(event())).rejects.toThrow(/archive the order/i)
  })

  it('fails closed when the ledger cannot be read', async () => {
    h.listPostingsForSource.mockResolvedValue({
      isErr: () => true,
      error: new Error('ledger unavailable'),
    })

    await expect(guardOrderDelete(event())).rejects.toThrow(/ledger unavailable/)
  })

  it('fails closed when the shipment log cannot be read', async () => {
    h.listOrderFulfillmentPostings.mockResolvedValue({
      isErr: () => true,
      error: new Error('shipment log unavailable'),
    })

    await expect(guardOrderDelete(event())).rejects.toThrow(/shipment log unavailable/)
  })
})

// 🛑 The whole point of reading the stamp. A paid Shopify order posts through a
// batch entry whose clearing, revenue, tax and shipping legs summarise under
// `fulfillment_batch`, so `listPostingsForSource` returns NOTHING for it. Every
// case in this block has an empty source-line read.
describe('guardOrderDelete: by the stamp alone', () => {
  it('refuses a live stamped posting even with the books wide open', async () => {
    stamps(stamp('gl_1', '2026-08-15'))

    await expect(guardOrderDelete(event())).rejects.toThrow(/AUXX-FUL-20260815/)
  })

  it('points at reversing the entry rather than at archiving', async () => {
    stamps(stamp('gl_1', '2026-08-15'))

    await expect(guardOrderDelete(event())).rejects.toThrow(/Reverse the entry first/)
  })

  it('names every live entry and counts them', async () => {
    stamps(stamp('gl_1', '2026-08-15'), stamp('gl_2', '2026-08-16'))

    await expect(guardOrderDelete(event())).rejects.toThrow(
      /2 ledger entries that are still standing: AUXX-FUL-20260815, AUXX-FUL-20260816/
    )
  })

  it('falls back to the posting id when the entry has no document number', async () => {
    stamps(stamp('gl_1', '2026-08-15', 'posted', null))

    await expect(guardOrderDelete(event())).rejects.toThrow(/gl_1/)
  })

  // Decision 9: reversing a run is what makes its orders deletable again, and
  // is also what puts their shipments back into the next bulk preview.
  it('allows a delete once every stamped posting is reversed', async () => {
    stamps(stamp('gl_1', '2026-08-15', 'reversed'))

    await expect(guardOrderDelete(event())).resolves.toBeUndefined()
  })

  // 🛑 The `txnDate` of a batch entry is the LATEST ship date in its group, so a
  // week grouping can date a July shipment into August. Testing the log's own
  // date instead of the posting's would test the wrong month.
  it('settles on the POSTING date, so a reversed entry in a closed month still refuses', async () => {
    stamps(stamp('gl_1', '2026-08-02', 'reversed'))
    h.postedPeriodRows.mockReturnValue(posted('2026-08'))

    await expect(guardOrderDelete(event())).rejects.toThrow(/1 ledger posting in 2026-08/)
  })

  it('counts source lines and stamps together when both name entries', async () => {
    postings(posting('2026-07-02'))
    stamps(stamp('gl_1', '2026-08-15', 'reversed'))
    h.postedPeriodRows.mockReturnValue(posted('2026-07', '2026-08'))

    await expect(guardOrderDelete(event())).rejects.toThrow(/2 ledger postings in 2026-07, 2026-08/)
  })

  it('reads the log by the order instance', async () => {
    await guardOrderDelete(event())

    expect(h.listOrderFulfillmentPostings).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      orderId: ORDER_ID,
    })
  })
})

describe('guardOrderDelete: the calendar date', () => {
  it('reads the first of a month as THAT month in the book zone, not the previous one', async () => {
    // `2026-08-01` is a calendar day. Parsed as UTC midnight it is still
    // 2026-07-31 in Los Angeles, and a posted August would not refuse it.
    postings(posting('2026-08-01'))
    h.postedPeriodRows.mockReturnValue(posted('2026-08'))

    await expect(guardOrderDelete(event())).rejects.toThrow(/2026-08/)
  })

  it('does not drag the first of an open month back into a locked one', async () => {
    postings(posting('2026-08-01'))
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(guardOrderDelete(event())).resolves.toBeUndefined()
  })
})

describe('guardOrderDelete: open books', () => {
  it('passes when every entry is in an OPEN period', async () => {
    postings(posting('2026-08-15'), posting('2026-08-16'))

    await expect(guardOrderDelete(event())).resolves.toBeUndefined()
  })

  it('settles nothing for an org that has not finished accounting setup', async () => {
    settings({ 'accounting.bookTimeZone': 'UTC' }) // no cutoff
    postings(posting('2026-08-15'))

    await expect(guardOrderDelete(event())).resolves.toBeUndefined()
  })

  it('skips the settled-period read entirely for an order with no entries', async () => {
    await guardOrderDelete(event())

    expect(h.getOrganizationSetting).not.toHaveBeenCalled()
    expect(h.resolvePeriodLock).not.toHaveBeenCalled()
  })

  it('looks the entries up by the fulfillment source, keyed on the order instance', async () => {
    await guardOrderDelete(event())

    expect(h.listPostingsForSource).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      sourceType: 'order',
      sourceId: ORDER_ID,
    })
  })
})
