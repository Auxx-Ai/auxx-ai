// packages/lib/src/field-hooks/pre/order-delete-guard.test.ts
// The guard that stops an order being hard-deleted out from under a fulfillment
// entry standing in a settled month.
//
// Modelled on `part-delete-guard.test.ts`. The settled predicates are the same
// three (`postings/settled-periods.ts`); what differs is the SUBJECT. A part is
// judged on its stock movements, an order on the general-ledger entries whose
// lines name it as `sourceType: 'order'`, and those carry a calendar `txnDate`
// rather than a timestamp, which is what the timezone case below pins.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreDeleteEvent } from '../types'

const h = vi.hoisted(() => ({
  listPostingsForSource: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postedPeriodRows: vi.fn(),
  getOrganizationSetting: vi.fn(),
}))

vi.mock('../../postings/list-postings', () => ({
  listPostingsForSource: h.listPostingsForSource,
}))

vi.mock('../../postings/period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))
vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: h.getOrganizationSetting,
}))

// `selectDistinct()` is the posted-period read inside `settledPeriodsFor`. The
// terminal `.where()` resolves, so a query that stops ending there fails loudly.
vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/database')
  const postedChain: Record<string, unknown> = {}
  postedChain.from = () => postedChain
  postedChain.where = async () => h.postedPeriodRows()

  return {
    ...actual,
    database: { selectDistinct: () => postedChain },
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
