// packages/lib/src/accounting/reports/__tests__/receivable-attribution.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../resources/system-records', () => ({ systemFieldMap: vi.fn() }))
vi.mock('../../../field-values/read-field-scalars', () => ({ readFieldRelations: vi.fn() }))
vi.mock('../../../settings/settings-service', () => ({ getOrganizationSetting: vi.fn() }))

import { readFieldRelations } from '../../../field-values/read-field-scalars'
import { systemFieldMap } from '../../../resources/system-records'
import { getOrganizationSetting } from '../../../settings/settings-service'
import {
  allocateByWeight,
  attributeToDocuments,
  prorateByWeight,
  readAttributionLinks,
  readPreCutoverDocumentIds,
  readReceivableSplits,
  type SourceTotal,
} from '../receivable-attribution'

const ORG = 'org_1'

/** Each `db.select()` chain resolves to the next entry of `queue`. */
function stubDb(queue: unknown[][]): Database {
  let index = 0
  function chain() {
    const c: Record<string, unknown> = {}
    for (const method of ['from', 'innerJoin', 'where', 'groupBy', 'orderBy']) c[method] = () => c
    const rows = queue[index] ?? []
    index += 1
    // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject)
    return c
  }
  return { select: () => chain() } as unknown as Database
}

function source(overrides: Partial<SourceTotal> & { sourceType: string; sourceId: string }) {
  return { debitMinor: 0, creditMinor: 0, docNumber: '', ...overrides }
}

function application(overrides: Record<string, unknown> & { id: string }) {
  return {
    moneyTransactionId: 'mt_1',
    operation: 'apply',
    amountMinor: 0n,
    orderInstanceId: null,
    invoiceInstanceId: null,
    vendorBillInstanceId: null,
    reversesApplicationId: null,
    effectiveDate: '2026-08-01',
    ...overrides,
  }
}

const net = (docs: SourceTotal[], key: string) => {
  const doc = docs.find((d) => `${d.sourceType}:${d.sourceId}` === key)
  return doc ? doc.debitMinor - doc.creditMinor : undefined
}

describe('allocateByWeight', () => {
  it('hands each weight over in full when they fit, leaving the rest', () => {
    expect(allocateByWeight(10_000, [6_000, 3_000])).toEqual([6_000, 3_000])
  })

  it('prorates by largest remainder when the weights exceed the total, summing exactly', () => {
    expect(allocateByWeight(100, [100, 100, 100])).toEqual([34, 33, 33])
    expect(allocateByWeight(9_000, [6_000, 4_000])).toEqual([5_400, 3_600])
  })
})

describe('prorateByWeight', () => {
  it('prorates even when the total exceeds the weights, summing exactly', () => {
    expect(prorateByWeight(12_000, [10_800, 1_200])).toEqual([10_800, 1_200])
    expect(prorateByWeight(5_000, [10_834, 3_610])).toEqual([3_750, 1_250])
    expect(prorateByWeight(20_001, [1, 1])).toEqual([10_001, 10_000])
  })

  it('gives nothing to zero weights', () => {
    expect(prorateByWeight(100, [0, 0])).toEqual([0, 0])
  })
})

describe('attributeToDocuments', () => {
  it('attributes a receipt through its applications across two orders', () => {
    const docs = attributeToDocuments(
      [
        source({ sourceType: 'order', sourceId: 'o1', debitMinor: 6_000 }),
        source({ sourceType: 'order', sourceId: 'o2', debitMinor: 4_000 }),
        source({ sourceType: 'money_transaction', sourceId: 'mt_1', creditMinor: 10_000 }),
      ],
      {
        movementTargets: new Map([
          [
            'mt_1',
            [
              { sourceType: 'order', sourceId: 'o1', weightMinor: 6_000 },
              { sourceType: 'order', sourceId: 'o2', weightMinor: 4_000 },
            ],
          ],
        ]),
        parents: new Map(),
      }
    )
    expect(net(docs, 'order:o1')).toBe(0)
    expect(net(docs, 'order:o2')).toBe(0)
    expect(net(docs, 'money_transaction:mt_1')).toBeUndefined()
  })

  it('keeps what no application covers on the movement, as unapplied', () => {
    const docs = attributeToDocuments(
      [source({ sourceType: 'money_transaction', sourceId: 'mt_1', creditMinor: 10_000 })],
      {
        movementTargets: new Map([
          ['mt_1', [{ sourceType: 'order', sourceId: 'o1', weightMinor: 7_500 }]],
        ]),
        parents: new Map(),
      }
    )
    expect(net(docs, 'order:o1')).toBe(-7_500)
    expect(net(docs, 'money_transaction:mt_1')).toBe(-2_500)
  })

  it('folds a credit memo into its order, and a refund routed to the memo lands there too', () => {
    const docs = attributeToDocuments(
      [
        source({ sourceType: 'order', sourceId: 'o1', debitMinor: 10_800 }),
        source({ sourceType: 'money_transaction', sourceId: 'rcpt', creditMinor: 10_800 }),
        source({ sourceType: 'credit_memo', sourceId: 'cm1', creditMinor: 10_800 }),
        source({ sourceType: 'money_transaction', sourceId: 'rfnd', debitMinor: 10_800 }),
      ],
      {
        movementTargets: new Map([
          ['rcpt', [{ sourceType: 'order', sourceId: 'o1', weightMinor: 10_800 }]],
          ['rfnd', [{ sourceType: 'credit_memo', sourceId: 'cm1', weightMinor: 10_800 }]],
        ]),
        parents: new Map([['credit_memo:cm1', { sourceType: 'order', sourceId: 'o1' }]]),
      }
    )
    expect(docs).toHaveLength(1)
    expect(net(docs, 'order:o1')).toBe(0)
  })

  it('leaves a refund with no memo and no application on itself, a debit', () => {
    const docs = attributeToDocuments(
      [source({ sourceType: 'money_transaction', sourceId: 'rfnd', debitMinor: 5_000 })],
      { movementTargets: new Map(), parents: new Map() }
    )
    expect(net(docs, 'money_transaction:rfnd')).toBe(5_000)
  })
})

describe('readAttributionLinks', () => {
  it('nets unapply against apply, and reaches a memo-settled refund through the memo', async () => {
    vi.mocked(systemFieldMap).mockResolvedValue({
      credit_memo_order: { id: 'f_order' },
      credit_memo_invoice: { id: 'f_invoice' },
    } as never)
    vi.mocked(readFieldRelations).mockResolvedValue(
      new Map([['cm1', new Map([['f_order', 'o9']])]])
    )
    const db = stubDb([
      // Applications of mt_1 and rfnd: o1 was unapplied and o2 applied instead.
      [
        application({ id: 'a1', orderInstanceId: 'o1', amountMinor: 5_000n }),
        application({
          id: 'a2',
          operation: 'unapply',
          orderInstanceId: 'o1',
          amountMinor: 5_000n,
          reversesApplicationId: 'a1',
        }),
        application({ id: 'a3', orderInstanceId: 'o2', amountMinor: 5_000n }),
      ],
      // rfnd has none, so its settlements are read.
      [
        {
          refundTransactionId: 'rfnd',
          originalTransactionId: null,
          customerCreditMemoInstanceId: 'cm1',
          amountMinor: 2_000n,
        },
      ],
    ])

    const links = (
      await readAttributionLinks(db, ORG, [
        source({ sourceType: 'money_transaction', sourceId: 'mt_1', creditMinor: 5_000 }),
        source({ sourceType: 'money_transaction', sourceId: 'rfnd', debitMinor: 2_000 }),
      ])
    )._unsafeUnwrap()

    expect(links.movementTargets.get('mt_1')).toEqual([
      { sourceType: 'order', sourceId: 'o2', weightMinor: 5_000 },
    ])
    expect(links.movementTargets.get('rfnd')).toEqual([
      { sourceType: 'credit_memo', sourceId: 'cm1', weightMinor: 2_000 },
    ])
    expect(links.parents.get('credit_memo:cm1')).toEqual({ sourceType: 'order', sourceId: 'o9' })
  })
})

describe('readPreCutoverDocumentIds', () => {
  it('names a document whose live applications all fall on or before the cutoff month', async () => {
    vi.mocked(getOrganizationSetting).mockResolvedValue('2026-06' as never)
    const db = stubDb([
      [
        application({ id: 'a1', orderInstanceId: 'o1', effectiveDate: '2026-05-20' }),
        application({ id: 'a2', orderInstanceId: 'o1', effectiveDate: '2026-06-30' }),
        application({ id: 'a3', orderInstanceId: 'o2', effectiveDate: '2026-06-01' }),
        application({ id: 'a4', orderInstanceId: 'o2', effectiveDate: '2026-07-01' }),
        // o3's only post-cutoff application was unapplied.
        application({ id: 'a5', orderInstanceId: 'o3', effectiveDate: '2026-05-01' }),
        application({ id: 'a6', orderInstanceId: 'o3', effectiveDate: '2026-07-10' }),
        application({
          id: 'a7',
          operation: 'unapply',
          orderInstanceId: 'o3',
          effectiveDate: '2026-07-11',
          reversesApplicationId: 'a6',
        }),
      ],
    ])

    const ids = (await readPreCutoverDocumentIds(db, ORG, ['o1', 'o2', 'o3', 'o4']))._unsafeUnwrap()
    expect([...ids].sort()).toEqual(['o1', 'o3'])
  })

  it('is empty when the org has no cutoff', async () => {
    vi.mocked(getOrganizationSetting).mockResolvedValue(null as never)
    const ids = (await readPreCutoverDocumentIds(stubDb([]), ORG, ['o1']))._unsafeUnwrap()
    expect(ids.size).toBe(0)
  })
})

describe('readReceivableSplits', () => {
  it('splits a receivable into documents in debit and documents in credit', async () => {
    const db = stubDb([
      [
        // Shipped and unpaid.
        {
          glAccountId: 'ar',
          sourceType: 'order',
          sourceId: 'o1',
          debitMinor: '10800',
          creditMinor: '0',
        },
        // Paid, unshipped: the receipt is applied to o2.
        {
          glAccountId: 'ar',
          sourceType: 'money_transaction',
          sourceId: 'mt_1',
          debitMinor: '0',
          creditMinor: '5000',
        },
        // Unapplied receipt.
        {
          glAccountId: 'ar',
          sourceType: 'money_transaction',
          sourceId: 'mt_2',
          debitMinor: '0',
          creditMinor: '700',
        },
      ],
      [
        application({
          id: 'a1',
          moneyTransactionId: 'mt_1',
          orderInstanceId: 'o2',
          amountMinor: 5_000n,
        }),
      ],
      // mt_2 has no application and no settlement.
      [],
    ])

    const splits = (
      await readReceivableSplits(db, ORG, { to: '2026-08-31', glAccountIds: ['ar'] })
    )._unsafeUnwrap()
    expect(splits.get('ar')).toEqual({ receivableMinor: 10_800, depositsMinor: 5_700 })
  })
})
