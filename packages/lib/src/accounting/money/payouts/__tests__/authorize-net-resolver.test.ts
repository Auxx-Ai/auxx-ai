// packages/lib/src/accounting/money/payouts/__tests__/authorize-net-resolver.test.ts

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

import { BRIDGE_ATTRIBUTES } from '../../customer-money/bridge'
import type { UnreferencedEntry } from '../reference-resolvers'
import { AUTHORIZE_NET_ENTRY_REFERENCE_RESOLVER } from '../resolvers/authorize-net'

/** Every bridged `customer_transaction` attribute as a field whose id is `f:<attribute>`. */
const transactionFields = [...BRIDGE_ATTRIBUTES.customer_transaction.keys()].map((attribute) => ({
  id: `f:${attribute}`,
  systemAttribute: attribute,
}))

/** One `FieldValue` row in the shape `pivotRecordFields` selects. */
const value = (entityId: string, attribute: string, text: string | null, related?: string) => ({
  entityId,
  fieldId: `f:${attribute}`,
  valueText: text,
  valueNumber: null,
  valueBoolean: null,
  valueDate: null,
  valueJson: null,
  relatedEntityId: related ?? null,
  updatedAt: new Date('2026-05-20T00:00:00.000Z'),
})

/** The five stored fields a resolvable Shopify transaction carries. */
const storedTransaction = (entityId: string, externalId: string, kind = 'receipt') => [
  value(entityId, 'customer_transaction_provider_key', 'shopify'),
  value(entityId, 'customer_transaction_account_id', 'lift.myshopify.com'),
  value(entityId, 'customer_transaction_environment', 'live'),
  value(entityId, 'customer_transaction_external_id', externalId),
  value(entityId, 'customer_transaction_kind', kind),
  value(entityId, 'customer_transaction_status', 'confirmed'),
]

/** Answers each `select` in order; a chain so both the joined and the plain read work. */
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
  sourceAccountId: 'feed',
  type: 'charge',
  sourceTransactionId: null,
  sourceId: null,
  sourceOrderId: null,
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

const resolve = AUTHORIZE_NET_ENTRY_REFERENCE_RESOLVER.resolve

beforeEach(() => {
  h.fields.clear()
  h.defs.clear()
  h.fields.set('ct-def', transactionFields)
  h.fields.set('order-def', [{ id: 'f:order_number', systemAttribute: 'order_number' }])
  h.defs.set('customer_transaction', 'ct-def')
  h.defs.set('order', 'order-def')
})

describe('the authorize_net entry reference resolver', () => {
  it('registers for authorize_net', () => {
    expect(AUTHORIZE_NET_ENTRY_REFERENCE_RESOLVER.providerKey).toBe('authorize_net')
  })

  it('names the transaction whose gateway id is the transId', async () => {
    const { db } = database([
      [{ entityId: 'ct-1', key: '60000001' }], // by gateway transaction id
      [], // by customer_transaction_order_external_id
      [], // by order_number
      storedTransaction('ct-1', '5544332211'), // the pivot
    ])
    const resolved = await resolve(db, 'org', [
      entry({ sourceTransactionId: '60000001', sourceOrderId: '#1234' }),
    ])
    expect(resolved.get('entry-1')).toEqual(reference('5544332211'))
  })

  it('falls back to the invoice number, treating #1234 and 1234 as one order', async () => {
    const { db } = database([
      [], // no gateway id stored yet
      [], // no transaction carries the order id verbatim
      [{ entityId: 'order-9', key: '#1234' }], // the order, found by its name
      [{ entityId: 'ct-2', key: 'order-9' }], // its one transaction
      storedTransaction('ct-2', '5544332299'),
    ])
    const resolved = await resolve(db, 'org', [
      entry({ sourceTransactionId: '60000002', sourceOrderId: '1234' }),
    ])
    expect(resolved.get('entry-1')).toEqual(reference('5544332299'))
  })

  it('matches a refund entry to the refund transaction on the order, not the receipt', async () => {
    // No transId on the entry, so the gateway-id read is skipped entirely.
    const { db } = database([
      [],
      [{ entityId: 'order-9', key: '#1234' }],
      [
        { entityId: 'ct-receipt', key: 'order-9' },
        { entityId: 'ct-refund', key: 'order-9' },
      ],
      [
        ...storedTransaction('ct-receipt', '5544332211'),
        ...storedTransaction('ct-refund', '5544332212', 'refund'),
      ],
    ])
    const resolved = await resolve(db, 'org', [entry({ type: 'refund', sourceOrderId: '#1234' })])
    expect(resolved.get('entry-1')).toEqual(reference('5544332212'))
  })

  it('leaves an order with two captures unreferenced rather than guessing', async () => {
    const { db } = database([
      [],
      [{ entityId: 'order-9', key: '#1234' }],
      [
        { entityId: 'ct-a', key: 'order-9' },
        { entityId: 'ct-b', key: 'order-9' },
      ],
      [...storedTransaction('ct-a', '1'), ...storedTransaction('ct-b', '2')],
    ])
    const resolved = await resolve(db, 'org', [entry({ sourceOrderId: '#1234' })])
    expect(resolved.size).toBe(0)
  })

  it('is silent for an entry that names nothing, and never queries', async () => {
    const { db, select } = database([])
    const resolved = await resolve(db, 'org', [entry()])
    expect(resolved.size).toBe(0)
    expect(select).not.toHaveBeenCalled()
  })

  it('is silent when the org has no customer_transaction definition', async () => {
    h.defs.set('customer_transaction', undefined)
    const { db, select } = database([])
    const resolved = await resolve(db, 'org', [entry({ sourceTransactionId: '60000001' })])
    expect(resolved.size).toBe(0)
    expect(select).not.toHaveBeenCalled()
  })

  it('refuses a candidate whose stored source account is incomplete', async () => {
    const { db } = database([
      [{ entityId: 'ct-1', key: '60000001' }],
      [],
      [],
      [value('ct-1', 'customer_transaction_external_id', '5544332211')],
    ])
    const resolved = await resolve(db, 'org', [entry({ sourceTransactionId: '60000001' })])
    expect(resolved.size).toBe(0)
  })
})
