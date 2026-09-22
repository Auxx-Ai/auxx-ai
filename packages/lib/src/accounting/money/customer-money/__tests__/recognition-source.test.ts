// packages/lib/src/accounting/money/customer-money/__tests__/recognition-source.test.ts

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  linked: [] as unknown[],
  askedFor: [] as unknown[],
  fulfillments: [] as unknown[],
}))
vi.mock('../../../ledger/reads/list-postings', () => ({
  findLinkedPostings: async (_db: unknown, _org: string, options: unknown) => {
    h.askedFor.push(options)
    return h.linked
  },
  findLiveSubjectPostings: async () => new Map(),
}))
vi.mock('../recognition-facts', () => ({
  readOrderRecognitionFactsInTx: async () => {
    const { UnprocessableEntityError } = await import('../../../../errors')
    // A refusal the reader folds into `blockers`; this harness carries no facts.
    throw new UnprocessableEntityError('canonical order facts unavailable')
  },
}))

import { readOrderMoneyCoverage } from '../reads'
import { readOrderRecognitionSource, sourceOccurrence } from '../recognition-source'

vi.mock('../reads', () => ({
  readOrderMoneyCoverage: vi.fn(async () => ({
    complete: true,
    fetched: 0,
    accepted: 0,
    pending: 0,
    sourceStoreIds: [] as string[],
  })),
}))
vi.mock('../../../sales/fulfillments/reads', () => ({
  readFulfillmentsForOrder: async () => h.fulfillments,
}))

const CREDIT_BLOCKER =
  'Order recognition must include its posted credit components before further posting'

/** Everything `readOrderRecognitionSource` reaches for beyond the mocked seams. */
const db = {
  query: new Proxy({} as Record<string, { findMany: () => Promise<unknown[]> }>, {
    get: () => ({ findMany: async () => [] }),
  }),
} as never

describe('the credit-memo blocker', () => {
  it('asks only for POSTED memos - a reversed one has been backed out', async () => {
    h.linked = []
    h.askedFor = []
    const source = await readOrderRecognitionSource(db, {
      organizationId: 'org_1',
      orderId: 'ord_1',
      orderNetMinor: '1000',
      orderTaxMinor: '0',
      bookTimeZone: 'UTC',
    })
    expect(h.askedFor[0]).toMatchObject({
      linkRole: 'parent',
      postingTypes: ['credit_memo'],
      statuses: ['posted'],
    })
    expect(source.blockers).not.toContain(CREDIT_BLOCKER)
    expect(readOrderMoneyCoverage).toHaveBeenCalled()
  })

  it('blocks while a posted memo parents the order', async () => {
    h.linked = [{ glPostingId: 'glp_1', sourceId: 'ord_1' }]
    const source = await readOrderRecognitionSource(db, {
      organizationId: 'org_1',
      orderId: 'ord_1',
      orderNetMinor: '1000',
      orderTaxMinor: '0',
      bookTimeZone: 'UTC',
    })
    expect(source.blockers).toContain(CREDIT_BLOCKER)
  })
})

describe('shipment totals', () => {
  const shipment = (over: Record<string, unknown>) => ({
    id: 'ful_1',
    status: 'success',
    shippedAt: '2026-09-04T12:00:00.000Z',
    subtotalMinor: 0,
    totalMinor: 0,
    shippingRecognised: false,
    totalsStamped: true,
    glPosting: null,
    ...over,
  })
  const read = () =>
    readOrderRecognitionSource(db, {
      organizationId: 'org_1',
      orderId: 'ord_1',
      orderNetMinor: '1000',
      orderTaxMinor: '0',
      bookTimeZone: 'UTC',
    })

  it('leaves a stamped $0 shipment out of the timeline instead of refusing it', async () => {
    h.linked = []
    h.fulfillments = [shipment({})]
    const source = await read()
    expect(source.events).toEqual([])
    expect(source.blockers.some((b) => b.includes('ful_1'))).toBe(false)
  })

  it('still refuses a shipment whose totals were never stamped', async () => {
    h.linked = []
    h.fulfillments = [shipment({ totalsStamped: false })]
    const source = await read()
    expect(source.blockers).toContain('fulfillment ful_1 has no stamped totals')
    h.fulfillments = []
  })
})

describe('sourceOccurrence', () => {
  it('normalizes PostgreSQL shipment timestamp text while refusing date-only evidence', () => {
    expect(sourceOccurrence('2026-07-05 19:49:02+00', 'shipment')).toBe('2026-07-05T19:49:02.000Z')
    expect(sourceOccurrence('2026-07-05T12:49:02-07:00', 'shipment')).toBe(
      '2026-07-05T19:49:02.000Z'
    )
    expect(() => sourceOccurrence('2026-07-05', 'shipment')).toThrow('occurrence instant')
  })
})
