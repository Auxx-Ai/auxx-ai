// packages/lib/src/accounting/money/payouts/__tests__/recognise.test.ts
//
// The legacy split's recogniser, now Stripe Connect's alone
// (`plans/accounting/payout-links.md` §11.3):
//
//  - `stripe_charge` resolves against `FinancialSourceObject`/`MoneySourceLink`
//    (the evidence trail a `MoneyTransaction` was adopted from a Stripe id
//    through), charge and refund ids sharing one keyspace;
//  - `none` is never looked up and never recognised, and a payout holding only
//    `none` refs lands wholly on the unrecognised side - which is every Shopify
//    item now that the order walk is gone.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sourceObjectRows: [] as { externalId: string }[],
  selects: [] as string[],
}))

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { splitPayout } from '../client'
import { recognise } from '../recognise'
import type { PayoutItem } from '../source'

const ORG = 'org_1'

/**
 * A `Database` answering the one table left: `FinancialSourceObject`, joined to
 * `MoneySourceLink`. `.where()` is unevaluated - the seeds are scoped to the query.
 */
function stubDb(): Database {
  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === schema.FinancialSourceObject) {
          h.selects.push('FinancialSourceObject')
          return { innerJoin: () => ({ where: () => Promise.resolve(h.sourceObjectRows) }) }
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
  h.sourceObjectRows = []
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
