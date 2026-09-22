// packages/lib/src/accounting/money/customer-money/__tests__/recognition-source.test.ts

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  linked: [] as unknown[],
  askedFor: [] as unknown[],
  applications: [] as unknown[],
  movements: new Map<string, unknown>(),
  listRefundSettlements: vi.fn(async () => [] as unknown[]),
  fulfillments: [] as unknown[],
  /** Sources with a draft waiting on approval, by kind. */
  drafts: new Map<string, Set<string>>(),
}))
vi.mock('../../reads', () => ({
  listOrderApplications: async () => h.applications,
  readMovements: async () => h.movements,
  listRefundSettlements: h.listRefundSettlements,
}))
vi.mock('../../../ledger/reads/list-postings', () => ({
  findLinkedPostings: async (_db: unknown, _org: string, options: unknown) => {
    h.askedFor.push(options)
    return h.linked
  },
  findLiveSubjectPostings: async () => new Map(),
  findPendingDraftPostings: async (
    _db: unknown,
    _org: string,
    options: { sourceKind: string; sourceIds: readonly string[] }
  ) =>
    new Map(
      options.sourceIds
        .filter((id) => h.drafts.get(options.sourceKind)?.has(id))
        .map((id) => [id, { glPostingId: `draft_${id}` }])
    ),
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

describe('a refunded receipt', () => {
  it('carries no refund blocker - the memo owns the refund, not the receipt', async () => {
    h.linked = []
    h.applications = [
      {
        moneyTransactionId: 'mt_1',
        operation: 'apply',
        effectiveDate: '2026-09-01',
        amountMinor: 10800n,
      },
    ]
    h.movements = new Map([
      [
        'mt_1',
        {
          id: 'mt_1',
          currency: 'USD',
          currencyExponent: 2,
          occurredAt: new Date('2026-09-01T12:00:00Z'),
          amountMinor: 10800n,
        },
      ],
    ])
    h.listRefundSettlements.mockClear()
    const source = await readOrderRecognitionSource(db, {
      organizationId: 'org_1',
      orderId: 'ord_1',
      orderNetMinor: '10000',
      orderTaxMinor: '800',
      bookTimeZone: 'UTC',
    })
    expect(source.blockers.some((row) => row.includes('refund settlement'))).toBe(false)
    expect(h.listRefundSettlements).not.toHaveBeenCalled()
    expect(source.events).toEqual([
      expect.objectContaining({ id: 'mt_1', kind: 'receipt', amountMinor: '10800' }),
    ])
    h.applications = []
    h.movements = new Map()
  })
})

describe('a $0 shipment', () => {
  it('is not an event - a free shipment recognises nothing (88 §7.3)', async () => {
    h.linked = []
    h.applications = []
    h.movements = new Map()
    h.fulfillments = [
      {
        id: 'ful_free',
        status: 'success',
        shippedAt: '2026-09-02 10:00:00+00',
        subtotalMinor: 0,
        totalMinor: 0,
        shippingRecognised: false,
        glPosting: null,
      },
      {
        id: 'ful_paid',
        status: 'success',
        shippedAt: '2026-09-03 10:00:00+00',
        subtotalMinor: 5000,
        totalMinor: 5000,
        shippingRecognised: false,
        glPosting: null,
      },
    ]
    const source = await readOrderRecognitionSource(db, {
      organizationId: 'org_1',
      orderId: 'ord_1',
      orderNetMinor: '5000',
      orderTaxMinor: '0',
      bookTimeZone: 'UTC',
    })
    expect(source.events.map((event) => event.id)).toEqual(['ful_paid'])
    h.fulfillments = []
  })
})

function shipment(id: string, shippedAt: string, glPosting: string | null = null) {
  return {
    id,
    status: 'success',
    shippedAt,
    subtotalMinor: 5000,
    totalMinor: 5000,
    shippingRecognised: false,
    glPosting,
  }
}

describe('a shipment no record carries yet (88 D6)', () => {
  it('joins the timeline as the target when supplied, and a record wins over it', async () => {
    h.linked = []
    h.fulfillments = [shipment('ful_1', '2026-09-02 10:00:00+00')]
    const supplied = {
      id: 'preview',
      kind: 'fulfillment' as const,
      effectiveDate: '2026-09-03',
      occurredAt: '2026-09-03T12:00:00.000Z',
      netMinor: '2500',
      taxMinor: '0',
    }
    const source = await readOrderRecognitionSource(db, {
      organizationId: 'org_1',
      orderId: 'ord_1',
      orderNetMinor: '7500',
      orderTaxMinor: '0',
      bookTimeZone: 'UTC',
      target: { kind: 'fulfillment', id: 'preview' },
      targetEvent: supplied,
    })
    expect(source.events.map((event) => event.id)).toEqual(['ful_1', 'preview'])
    // The earlier record has not posted, so the supplied one waits behind it.
    expect(source.blockers).toContain('earlier shipment accounting pending for fulfillment ful_1')

    const stale = await readOrderRecognitionSource(db, {
      organizationId: 'org_1',
      orderId: 'ord_1',
      orderNetMinor: '5000',
      orderTaxMinor: '0',
      bookTimeZone: 'UTC',
      target: { kind: 'fulfillment', id: 'ful_1' },
      targetEvent: { ...supplied, id: 'ful_1', netMinor: '1' },
    })
    expect(stale.events).toEqual([expect.objectContaining({ id: 'ful_1', netMinor: '5000' })])
    h.fulfillments = []
  })
})

describe('a refusal caused by a draft (88 D10)', () => {
  it('names the draft on an earlier shipment instead of saying pending', async () => {
    h.linked = []
    h.fulfillments = [
      shipment('ful_1', '2026-09-02 10:00:00+00'),
      shipment('ful_2', '2026-09-03 10:00:00+00'),
    ]
    h.drafts = new Map([['fulfillment', new Set(['ful_1'])]])
    const source = await readOrderRecognitionSource(db, {
      organizationId: 'org_1',
      orderId: 'ord_1',
      orderNetMinor: '10000',
      orderTaxMinor: '0',
      bookTimeZone: 'UTC',
      target: { kind: 'fulfillment', id: 'ful_2' },
    })
    expect(source.blockers).toContain('earlier shipment ful_1 is a draft awaiting approval')
    expect(source.blockers).not.toContain(
      'earlier shipment accounting pending for fulfillment ful_1'
    )
    h.drafts = new Map()
    h.fulfillments = []
  })

  it('still says pending when there is no draft to approve', async () => {
    h.linked = []
    h.fulfillments = [
      shipment('ful_1', '2026-09-02 10:00:00+00'),
      shipment('ful_2', '2026-09-03 10:00:00+00'),
    ]
    const source = await readOrderRecognitionSource(db, {
      organizationId: 'org_1',
      orderId: 'ord_1',
      orderNetMinor: '10000',
      orderTaxMinor: '0',
      bookTimeZone: 'UTC',
      target: { kind: 'fulfillment', id: 'ful_2' },
    })
    expect(source.blockers).toContain('earlier shipment accounting pending for fulfillment ful_1')
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
