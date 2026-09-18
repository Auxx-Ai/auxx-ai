// packages/lib/src/accounting/money/payouts/__tests__/recognise.test.ts
//
// brief 27 §4 rule 1 / §13 test 2: recognition is keyed on `ref.kind`.
//
//  - `stripe_charge` resolves against `FinancialSourceObject`/`MoneySourceLink`
//    (the evidence trail a `MoneyTransaction` was adopted from a Stripe id
//    through), charge and refund ids sharing one keyspace;
//  - `order` resolves against the synced order: `DataConnectorItem.externalId`
//    on the org's `order` def, bound and not archived;
//  - `none` is never looked up and never recognised, and a payout holding only
//    `none` refs lands wholly on the unrecognised side.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getCachedEntityDefId: vi.fn(async (_org: string, _slug: string) => 'def_order' as string | null),
  sourceObjectRows: [] as { externalId: string }[],
  orderRows: [] as { externalId: string }[],
  selects: [] as string[],
}))

vi.mock('../../../../cache', () => ({
  getCachedEntityDefId: h.getCachedEntityDefId,
}))

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { splitPayout } from '../client'
import { readRecognisedOrderIds, recognise } from '../recognise'
import type { PayoutItem } from '../source'

const ORG = 'org_1'

/**
 * A `Database` answering by TABLE: `FinancialSourceObject` (joined to
 * `MoneySourceLink`) gets the recognised-id rows; `DataConnectorItem` gets the
 * order rows. `.where()` is unevaluated - the seeds are scoped to the query.
 */
function stubDb(): Database {
  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === schema.FinancialSourceObject) {
          h.selects.push('FinancialSourceObject')
          return { innerJoin: () => ({ where: () => Promise.resolve(h.sourceObjectRows) }) }
        }
        if (table === schema.DataConnectorItem) {
          h.selects.push('DataConnectorItem')
          return { where: () => Promise.resolve(h.orderRows) }
        }
        throw new Error('unexpected table')
      },
    }),
  } as unknown as Database
}

function item(ref: PayoutItem['ref'], externalId = 'bt_1'): PayoutItem {
  return { externalId, grossMinor: 10_000, feeMinor: 300, ref }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getCachedEntityDefId.mockResolvedValue('def_order')
  h.sourceObjectRows = []
  h.orderRows = []
  h.selects = []
})

describe('recognise: stripe_charge', () => {
  it('recognises a charge auxx holds a MoneyTransaction for', async () => {
    h.sourceObjectRows = [{ externalId: 'ch_a' }]

    const recognised = await recognise(stubDb(), ORG, [
      item({ kind: 'stripe_charge', id: 'ch_a' }),
      item({ kind: 'stripe_charge', id: 'ch_b' }, 'bt_2'),
    ])

    expect(recognised).toEqual(new Set(['ch_a']))
  })

  it('recognises a refund through the same keyspace, so it stays on its charge’s side', async () => {
    h.sourceObjectRows = [{ externalId: 're_x' }]

    const recognised = await recognise(stubDb(), ORG, [item({ kind: 'stripe_charge', id: 're_x' })])

    expect(recognised).toEqual(new Set(['re_x']))
  })

  it('never touches the connector binding table for charge refs', async () => {
    h.sourceObjectRows = [{ externalId: 'ch_a' }]

    await recognise(stubDb(), ORG, [item({ kind: 'stripe_charge', id: 'ch_a' })])

    expect(h.selects).toEqual(['FinancialSourceObject'])
  })
})

describe('recognise: order', () => {
  it('recognises an order the connector has synced, by its upstream id on the order def', async () => {
    h.orderRows = [{ externalId: '1001' }]

    const recognised = await recognise(stubDb(), ORG, [
      item({ kind: 'order', id: '1001' }),
      item({ kind: 'order', id: '1002' }, 'bt_2'),
    ])

    expect(recognised).toEqual(new Set(['1001']))
    expect(h.getCachedEntityDefId).toHaveBeenCalledWith(ORG, 'order')
    expect(h.selects).toEqual(['DataConnectorItem'])
  })

  it('recognises nothing, without a query, when the org has no order def', async () => {
    h.getCachedEntityDefId.mockResolvedValue(null)
    h.orderRows = [{ externalId: '1001' }]

    const recognised = await readRecognisedOrderIds(stubDb(), ORG, ['1001'])

    expect(recognised.size).toBe(0)
    expect(h.selects).toEqual([])
  })

  it('does not consult the source-object evidence trail for an order ref', async () => {
    // 🛑 R3: an adapter that recognised Shopify items on a charge id would land
    // every Shopify payout in `2450`. The order path must not depend on the
    // payment evidence trail at all.
    h.orderRows = [{ externalId: '1001' }]

    await recognise(stubDb(), ORG, [item({ kind: 'order', id: '1001' })])

    expect(h.selects).not.toContain('FinancialSourceObject')
  })
})

describe('recognise: none', () => {
  it('looks nothing up and recognises nothing', async () => {
    const recognised = await recognise(stubDb(), ORG, [
      item({ kind: 'none' }),
      item({ kind: 'none' }, 'bt_2'),
    ])

    expect(recognised.size).toBe(0)
    expect(h.selects).toEqual([])
  })

  it('lands a payout of only `none` refs wholly on the unrecognised side', async () => {
    const items = [
      item({ kind: 'none' }),
      { externalId: 'bt_2', grossMinor: -2_500, feeMinor: 0, ref: { kind: 'none' } as const },
    ]

    const split = splitPayout(items, await recognise(stubDb(), ORG, items))

    expect(split).toEqual({
      grossMinor: 0,
      feesMinor: 0,
      netMinor: 0,
      unrecognisedNetMinor: 10_000 - 300 - 2_500,
      unrecognisedCount: 2,
    })
  })
})

describe('recognise: mixed kinds', () => {
  it('answers each kind from its own lookup and unions the ids', async () => {
    h.sourceObjectRows = [{ externalId: 'ch_a' }]
    h.orderRows = [{ externalId: '1001' }]

    const recognised = await recognise(stubDb(), ORG, [
      item({ kind: 'stripe_charge', id: 'ch_a' }),
      item({ kind: 'order', id: '1001' }, 'bt_2'),
      item({ kind: 'none' }, 'bt_3'),
    ])

    expect(recognised).toEqual(new Set(['ch_a', '1001']))
  })
})
