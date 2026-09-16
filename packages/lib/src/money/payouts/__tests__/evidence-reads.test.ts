// packages/lib/src/money/payouts/__tests__/evidence-reads.test.ts
import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PayoutRecordEvidence } from '../record-contracts'

const state = vi.hoisted(() => ({ matches: vi.fn() }))
vi.mock('../match-entries', () => ({ matchProcessorEntries: state.matches }))

import {
  getPayoutEvidence,
  listPayoutEvidence,
  listPayoutEvidenceHistory,
  listProcessorBalanceEntries,
} from '../evidence-reads'

function database(results: unknown[][]) {
  const limits: number[] = []
  const select = vi.fn(() => {
    const rows = results.shift()
    if (!rows) throw new Error('Unexpected extra query')
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (limit: number) => {
        limits.push(limit)
        return chain
      },
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
      then: (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve),
    }
    return chain
  })
  return { db: { select } as unknown as Database, select, limits }
}
const account = {
  providerKey: 'processor-other',
  externalAccountId: 'merchant/complete/id',
  environment: 'live',
}
function transfer(index = 1) {
  return {
    id: `transfer-${index}`,
    organizationId: 'org',
    sourceObjectId: 'source',
    sourceAccountId: 'account',
    currentObservationId: 'header-last',
    externalId: 'payout-1',
    status: 'paid',
    sourceAmountMinor: 9007199254740993n,
    sourceCurrency: 'USD',
    sourceCurrencyExponent: 2,
    destinationAmountMinor: 9007199254740993n,
    destinationCurrency: 'USD',
    destinationCurrencyExponent: 2,
    occurredAt: null,
    occurredOn: '2026-09-15',
    datePrecision: 'date',
    updatedAt: new Date('2026-09-15T12:00:00Z'),
    reconciliationState: 'complete',
    reconciledAt: new Date('2026-09-15T12:00:00Z'),
    reconciliationResult: {
      state: 'complete',
      providerReady: true,
      entryCount: 7,
      constituentNetMinor: '9007199254740990',
      differenceMinor: '3',
      reason: null,
      blockers: ['Difference needs review'],
      nextActions: ['Check the original amount'],
      unmatchedCount: 0,
    },
  }
}
const joined = (row = transfer()) => ({
  transfer: row,
  account,
  snapshot: {},
  acquisitionId: 'acquisition',
})
function evidence(): PayoutRecordEvidence {
  return {
    version: 2,
    sourceAccount: { ...account, environment: 'live' },
    acquisition: { id: 'acquisition', startedAt: '2026-09-15T12:00:00Z' },
    raw: {},
    rejectionReason: null,
    payout: {
      id: 'payout-1',
      status: 'paid',
      amount: '97.00',
      currency: 'USD',
      currencyExponent: 2,
      issuedAt: null,
      issuedOn: '2026-09-15',
      destinationExternalId: null,
      raw: {},
    },
    membership: {
      providerReady: true,
      complete: true,
      reason: null,
      page: { id: 'page-0', index: 0, requestCursor: null, nextCursor: null, terminal: true },
      rejections: [],
      rawRows: [],
      entries: [
        {
          id: 'entry-1',
          type: 'charge',
          providerType: 'capture',
          gross: '100.00',
          fee: '3.00',
          net: '97.00',
          currency: 'USD',
          currencyExponent: 2,
          transactionDate: null,
          payoutId: 'payout-1',
          sourceTransactionId: 'opaque/source/id',
          sourceOrderId: null,
          sourceId: null,
          sourceType: null,
          sourceReference: {
            sourceAccount: {
              providerKey: 'processor-other',
              externalAccountId: 'merchant/complete/id',
              environment: 'live',
            },
            objectType: 'capture',
            externalId: 'opaque/source/id',
            componentKey: '',
          },
          raw: {},
        },
        {
          id: 'outgoing',
          type: 'outgoing_transfer',
          providerType: 'payout',
          gross: '-97.00',
          fee: '0',
          net: '-97.00',
          currency: 'USD',
          currencyExponent: 2,
          transactionDate: null,
          payoutId: 'payout-1',
          sourceTransactionId: null,
          sourceOrderId: null,
          sourceId: null,
          sourceType: null,
          raw: {},
        },
      ],
    },
  }
}
const coverage = {
  fetchedBoundary: {
    acquisitionId: 'acquisition',
    headerObservationId: 'header-first',
    pageObservations: [
      {
        id: 'page-observation',
        index: 0,
        pageId: 'page-0',
        requestCursor: null,
        nextCursor: null,
        terminal: true,
      },
    ],
  },
}
beforeEach(() => {
  state.matches.mockReset()
  state.matches.mockResolvedValue(new Map())
})
describe('bounded provider-independent payout reads', () => {
  it.each([
    10, 100,
  ])('lists %s saved assessments in one query without re-running matching', async (count) => {
    const { db, select, limits } = database([
      Array.from({ length: count + 1 }, (_, index) => joined(transfer(index))),
    ])
    const result = await listPayoutEvidence(db, { organizationId: 'org', limit: count })
    expect(result.items).toHaveLength(count)
    expect(result.items[0]).toMatchObject({
      sourceAmountMinor: '9007199254740993',
      constituentNetMinor: '9007199254740990',
      differenceMinor: '3',
      providerKey: 'processor-other',
      entryCount: 7,
    })
    // The day the list sorts on, then the id — an id alone cannot place a page
    // boundary in a date-ordered list.
    expect(result.nextCursor).toBe(`2026-09-15|transfer-${count - 1}`)
    expect(select).toHaveBeenCalledOnce()
    expect(limits).toEqual([count + 1])
    expect(state.matches).not.toHaveBeenCalled()
  })
  it('does not display a previous complete assessment while current evidence is pending', async () => {
    const row = transfer()
    row.reconciliationState = 'pending'
    const { db } = database([[joined(row)], [{ payload: { current: true } }]])
    const detail = await getPayoutEvidence(db, { organizationId: 'org', id: row.id })
    expect(detail).toMatchObject({
      reconciliationState: 'pending',
      membershipState: 'incomplete',
      constituentNetMinor: null,
      differenceMinor: null,
      sourceObservation: { current: true },
    })
  })
  it('pages history without reading all past membership observations', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      observation: { id: `observation-${index}`, observedAt: new Date(), payload: evidence() },
    }))
    const { db, select, limits } = database([rows])
    const result = await listPayoutEvidenceHistory(db, {
      organizationId: 'org',
      transferId: 'transfer-1',
      limit: 20,
    })
    expect(result.items).toHaveLength(20)
    expect(result.nextCursor).toBe('observation-19')
    expect(select).toHaveBeenCalledOnce()
    expect(limits).toEqual([21])
  })
  it('reads exact immutable membership without requiring separately materialized activity rows', async () => {
    const { db, select } = database([[joined()], [coverage], [{ payload: evidence() }]])
    const result = await listProcessorBalanceEntries(db, {
      organizationId: 'org',
      transferId: 'transfer-1',
      limit: 1,
    })
    expect(result.items[0]).toMatchObject({
      externalId: 'entry-1',
      grossMinor: '10000',
      feeMinor: '300',
      netMinor: '9700',
      sourceTransactionId: 'opaque/source/id',
      providerKey: 'processor-other',
    })
    expect(state.matches).toHaveBeenCalledOnce()
    expect(state.matches.mock.calls[0]![2][0].sourceReference.externalId).toBe('opaque/source/id')
    expect(select).toHaveBeenCalledTimes(3)
    const cursor = JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString())
    expect(cursor).toMatchObject({
      headerObservationId: 'header-last',
      acquisitionId: 'acquisition',
      pageIndex: 0,
      offset: 1,
    })
    const next = database([[joined()], [coverage], [{ payload: evidence() }]])
    const page2 = await listProcessorBalanceEntries(next.db, {
      organizationId: 'org',
      transferId: 'transfer-1',
      limit: 1,
      cursor: result.nextCursor!,
    })
    expect(page2.items[0]).toMatchObject({
      externalId: 'outgoing',
      grossMinor: '-9700',
      isOutgoingTransfer: true,
    })
    expect(page2.nextCursor).toBeNull()
  })
  it('refuses to mix membership from different current observations while paging', async () => {
    const { db, select } = database([[joined()], [coverage]])
    const cursor = Buffer.from(
      JSON.stringify({
        acquisitionId: 'acquisition',
        headerObservationId: 'previous-header',
        pageIndex: 0,
        offset: 1,
      })
    ).toString('base64url')
    await expect(
      listProcessorBalanceEntries(db, {
        organizationId: 'org',
        transferId: 'transfer-1',
        limit: 20,
        cursor,
      })
    ).rejects.toThrow('Payout membership changed')
    expect(select).toHaveBeenCalledTimes(2)
    expect(state.matches).not.toHaveBeenCalled()
  })
  it('does not coerce malformed membership money into a zero amount', async () => {
    const payload = evidence()
    payload.membership.entries[0]!.gross = 'not money'
    const { db } = database([[joined()], [coverage], [{ payload }]])
    await expect(
      listProcessorBalanceEntries(db, {
        organizationId: 'org',
        transferId: 'transfer-1',
        limit: 20,
      })
    ).rejects.toThrow('membership amount is invalid')
    expect(state.matches).not.toHaveBeenCalled()
  })
  it('passes one complete current activity batch to exact source matching', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      account,
      entry: {
        id: `entry-${index}`,
        sourceAccountId: 'account',
        externalId: `opaque/${index}`,
        type: 'charge',
        grossMinor: 100n,
        feeMinor: 3n,
        netMinor: 97n,
        currency: 'USD',
        currencyExponent: 2,
        transactionDate: null,
        payoutExternalId: null,
        sourceTransactionId: `opaque/${index}`,
        sourceOrderId: null,
        sourceReference: null,
        isOutgoingTransfer: false,
      },
    }))
    const { db, select } = database([rows])
    const result = await listProcessorBalanceEntries(db, {
      organizationId: 'org',
      limit: 100,
      unassignedOnly: true,
    })
    expect(result.items).toHaveLength(100)
    expect(select).toHaveBeenCalledOnce()
    expect(state.matches).toHaveBeenCalledOnce()
    expect(state.matches.mock.calls[0]![2]).toHaveLength(100)
  })
})
