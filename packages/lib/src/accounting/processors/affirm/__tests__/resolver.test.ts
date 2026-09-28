// packages/lib/src/accounting/processors/affirm/__tests__/resolver.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fields: new Map<string, Array<{ id: string; systemAttribute: string | null }>>(),
  defs: new Map<string, string | undefined>(),
}))

vi.mock('../../../../cache', () => ({
  getCachedEntityDefId: async (_org: string, kind: string) => h.defs.get(kind),
  getCachedCustomFields: async (_org: string, defId: string) => h.fields.get(defId) ?? [],
}))

import { BRIDGE_ATTRIBUTES } from '../../../money/customer-money/bridge'
import type { UnreferencedEntry } from '../../../money/payouts/reference-resolvers'
import { AFFIRM_ENTRY_REFERENCE_RESOLVER } from '../resolver'

const transactionFields = [...BRIDGE_ATTRIBUTES.customer_transaction.keys()].map((attribute) => ({
  id: `f:${attribute}`,
  systemAttribute: attribute,
}))

/** One `FieldValue` row in the shape `pivotRecordFields` selects. */
const value = (entityId: string, attribute: string, text: string | null) => ({
  entityId,
  fieldId: `f:${attribute}`,
  valueText: text,
  valueNumber: null,
  valueBoolean: null,
  valueDate: null,
  valueJson: null,
  relatedEntityId: null,
  updatedAt: new Date('2026-05-20T00:00:00.000Z'),
})

/** A stored Shopify transaction. */
const stored = (
  entityId: string,
  externalId: string,
  kind: string,
  amount: string,
  status = 'confirmed'
) => [
  value(entityId, 'customer_transaction_provider_key', 'shopify'),
  value(entityId, 'customer_transaction_account_id', 'lift.myshopify.com'),
  value(entityId, 'customer_transaction_environment', 'live'),
  value(entityId, 'customer_transaction_external_id', externalId),
  value(entityId, 'customer_transaction_kind', kind),
  value(entityId, 'customer_transaction_status', status),
  value(entityId, 'customer_transaction_amount', amount),
]

/** Answers each `select` in order. */
function database(results: unknown[][]) {
  const select = vi.fn(() => {
    const rows = results.shift() ?? []
    const chain = {
      from: () => chain,
      $dynamic: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
      then: (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve),
    }
    return chain
  })
  return { db: { select } as unknown as Database, select }
}

const entry = (overrides: Partial<UnreferencedEntry> = {}): UnreferencedEntry => ({
  id: 'entry-1',
  sourceAccountId: 'affirm-feed',
  type: 'charge',
  sourceTransactionId: 'affirm-txn',
  sourceId: 'N4JY-UAE0',
  sourceOrderId: 'pay-1',
  grossMinor: 319_746,
  ...overrides,
})

const reference = (externalId: string) => ({
  sourceAccount: {
    providerKey: 'shopify',
    externalAccountId: 'lift.myshopify.com',
    environment: 'live',
  },
  objectType: 'order_transaction',
  externalId,
  componentKey: '',
})

const resolve = AFFIRM_ENTRY_REFERENCE_RESOLVER.resolve

beforeEach(() => {
  h.fields.clear()
  h.defs.clear()
  h.fields.set('ct-def', transactionFields)
  h.defs.set('customer_transaction', 'ct-def')
})

describe('the affirm entry reference resolver', () => {
  it('registers for affirm', () => {
    expect(AFFIRM_ENTRY_REFERENCE_RESOLVER.providerKey).toBe('affirm')
  })

  it('names the receipt whose payment id is the charge order id', async () => {
    const { db } = database([
      [{ entityId: 'ct-1', key: 'pay-1' }], // by payment id
      stored('ct-1', '9682489114800', 'receipt', '3197.46'), // the pivot
    ])
    const resolved = await resolve(db, 'org', [entry()])
    expect(resolved.get('entry-1')).toEqual(reference('9682489114800'))
  })

  it('names the child refund of the receipt with the entry amount', async () => {
    const { db } = database([
      [{ entityId: 'ct-1', key: 'pay-1' }],
      stored('ct-1', '8854350168240', 'receipt', '2923.43'),
      [
        { entityId: 'ct-2', key: '8854350168240' },
        { entityId: 'ct-3', key: '8854350168240' },
      ], // children by parent
      [
        ...stored('ct-2', '8949396111536', 'refund', '100.0'),
        ...stored('ct-3', '9084148383920', 'refund', '2120.0'),
      ],
    ])
    const resolved = await resolve(db, 'org', [entry({ type: 'refund', grossMinor: -212_000 })])
    expect(resolved.get('entry-1')).toEqual(reference('9084148383920'))
  })

  it('leaves a refund unresolved when two children share its amount', async () => {
    const { db } = database([
      [{ entityId: 'ct-1', key: 'pay-1' }],
      stored('ct-1', 'r-1', 'receipt', '500.00'),
      [
        { entityId: 'ct-2', key: 'r-1' },
        { entityId: 'ct-3', key: 'r-1' },
      ],
      [...stored('ct-2', 'x-2', 'refund', '100.00'), ...stored('ct-3', 'x-3', 'refund', '100.00')],
    ])
    const resolved = await resolve(db, 'org', [entry({ type: 'refund', grossMinor: -10_000 })])
    expect(resolved.size).toBe(0)
  })

  it('leaves an entry unresolved when no transaction carries its payment id', async () => {
    const { db } = database([[]])
    const resolved = await resolve(db, 'org', [entry()])
    expect(resolved.size).toBe(0)
  })

  it('ignores an unconfirmed receipt', async () => {
    const { db } = database([
      [{ entityId: 'ct-1', key: 'pay-1' }],
      stored('ct-1', 'r-1', 'receipt', '3197.46', 'pending'),
    ])
    const resolved = await resolve(db, 'org', [entry()])
    expect(resolved.size).toBe(0)
  })
})
