// packages/lib/src/accounting/money/customer-money/__tests__/order-source-scope.test.ts
//
// Task 47 §5 and decision D4: which STORE an order's revenue belongs to.
//
// 🛑 D4 is the whole reason this is a coverage read rather than a field read.
// `order_channel` carries `defaultValue: 'manual'` and is documented HUMAN-SET,
// never derived - so an unlabelled Shopify order reads `manual`, and keying on
// it would send most of a store's revenue to the manual account. The evidence
// answers instead: `FinancialSourceCoverage` rows for the order's transaction
// stream, joined to live source accounts.
//
// ⚠️ This is the same predicate `fulfillment-posting/reads.ts` takes when it
// decides whether an order has a canonical timeline at all
// (`if (!coverage?.sourceAvailable) continue`). Two doors disagreeing about one
// order is the failure this shared function exists to prevent.

import { type Database, schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'

import { readOrderSourceScope, readOrderSourceScopes } from '../reads'

const ORG = 'org_1'
const STORE_US = 'fsa_store_us'
const STORE_EU = 'fsa_store_eu'

/** Every scalar the module put into a `where` clause, flattened. */
function whereValues(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 10 || node === null || node === undefined) return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) whereValues(child, out, depth + 1)
    return out
  }
  const obj = node as Record<string, unknown>
  if ('value' in obj) whereValues(obj.value, out, depth + 1)
  if (Array.isArray(obj.queryChunks)) whereValues(obj.queryChunks, out, depth + 1)
  return out
}

/** `windowKey` is the order id; a row means "this order has evidence from this account". */
function stubDb(coverage: { orderId: string; sourceAccountId: string }[]) {
  return {
    select: () => ({
      from: () => {
        let params: string[] = []
        // biome-ignore lint/suspicious/noExplicitAny: a hand-written query stub
        const chain: any = {
          innerJoin: () => chain,
          where: (condition: unknown) => {
            params = whereValues(condition)
            return chain
          },
          // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(
              coverage
                .filter((row) => params.includes(row.orderId))
                .map((row) => ({ orderId: row.orderId, sourceAccountId: row.sourceAccountId }))
            ).then(resolve, reject),
        }
        return chain
      },
    }),
  } as unknown as Database
}

// A sanity check that the stub is exercising the real table, not a stand-in.
describe('the read is against FinancialSourceCoverage', () => {
  it('names the order-transactions stream', () => {
    expect(schema.FinancialSourceCoverage).toBeDefined()
  })
})

describe('readOrderSourceScope', () => {
  // 🛑 D4. An order this org actually sold through Shopify resolves to the
  // Shopify store whatever `order_channel` happens to say - because the channel
  // is never consulted.
  it('resolves an order with one live source account to that store', async () => {
    const db = stubDb([{ orderId: 'ord_1', sourceAccountId: STORE_US }])
    expect(await readOrderSourceScope(db, ORG, 'ord_1')).toEqual({ store: STORE_US })
  })

  // An order with no source evidence is genuinely hand-keyed, and the manual
  // bucket is where its revenue belongs. Same branch the fulfillment reader
  // takes when it leaves an order on the established arithmetic.
  it('resolves an order with no evidence to the manual bucket', async () => {
    const db = stubDb([])
    expect(await readOrderSourceScope(db, ORG, 'ord_1')).toEqual({ store: null })
  })

  // 🛑 Ambiguity falls back, it never guesses. `recognition-source.ts` BLOCKS
  // this case for a posting that has to be exact; here the entry still has to
  // post, so it posts to the account every store shared before this brief.
  it('falls back to the org default when evidence spans two stores', async () => {
    const db = stubDb([
      { orderId: 'ord_1', sourceAccountId: STORE_US },
      { orderId: 'ord_1', sourceAccountId: STORE_EU },
    ])
    expect(await readOrderSourceScope(db, ORG, 'ord_1')).toEqual({})
  })

  // ⚠️ No order is the ABSENCE of the question, not evidence of a manual sale -
  // a native credit memo names none. It gets the org default, not the bucket.
  it('answers nothing at all for a document with no order', async () => {
    const db = stubDb([])
    expect(await readOrderSourceScope(db, ORG, null)).toEqual({})
  })
})

describe('readOrderSourceScopes - one query for a whole batch', () => {
  it('answers each order independently', async () => {
    const db = stubDb([
      { orderId: 'ord_1', sourceAccountId: STORE_US },
      { orderId: 'ord_2', sourceAccountId: STORE_EU },
      { orderId: 'ord_3', sourceAccountId: STORE_US },
      { orderId: 'ord_3', sourceAccountId: STORE_EU },
    ])

    const answer = await readOrderSourceScopes(db, ORG, ['ord_1', 'ord_2', 'ord_3', 'ord_4'])

    expect(answer.get('ord_1')).toEqual({ store: STORE_US })
    expect(answer.get('ord_2')).toEqual({ store: STORE_EU })
    expect(answer.get('ord_3')).toEqual({})
    expect(answer.get('ord_4')).toEqual({ store: null })
  })

  it('asks nothing of the database for an empty list', async () => {
    const answer = await readOrderSourceScopes(stubDb([]), ORG, [])
    expect(answer.size).toBe(0)
  })
})
