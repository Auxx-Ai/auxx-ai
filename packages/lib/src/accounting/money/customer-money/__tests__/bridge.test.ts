// packages/lib/src/accounting/money/customer-money/__tests__/bridge.test.ts

import { FieldType } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fields: new Map<string, Array<{ id: string; systemAttribute: string | null }>>(),
  rows: [] as Array<Record<string, unknown>>,
  selects: 0,
}))

vi.mock('../../../../cache', () => ({
  getCachedEntityDefId: async (_org: string, kind: string) => `${kind}-def`,
  getCachedCustomFields: async (_org: string, defId: string) => h.fields.get(defId) ?? [],
}))

import {
  BRIDGE_ATTRIBUTES,
  bridgeFieldSpecs,
  pivotRecordFields,
  readFieldValue,
  storedFinancialFacts,
} from '../bridge'

/** A db stand-in that answers one `select … from FieldValue … where …` with fixed rows. */
const fakeDb = () =>
  ({
    select: () => ({
      from: () => ({
        where: async () => {
          h.selects++
          return h.rows
        },
      }),
    }),
  }) as never

const value = (over: Partial<Record<string, unknown>> = {}) => ({
  valueText: null,
  valueNumber: null,
  valueBoolean: null,
  valueDate: null,
  valueJson: null,
  relatedEntityId: null,
  updatedAt: new Date('2026-09-18T00:00:00.000Z'),
  ...over,
})

beforeEach(() => {
  h.fields = new Map()
  h.rows = []
  h.selects = 0
})

describe('the attribute lists come from the registry', () => {
  it('covers every source attribute of each financial def', () => {
    expect(BRIDGE_ATTRIBUTES.payout.get('payout_source_external_id')).toBe(FieldType.TEXT)
    expect(BRIDGE_ATTRIBUTES.payout.get('payout_source_membership')).toBe(FieldType.JSON)
    expect(BRIDGE_ATTRIBUTES.payout.get('payout_source_currency_exponent')).toBe(FieldType.NUMBER)
    // `payout_processor_entries` is the has_many side; its rows live on the child.
    expect(BRIDGE_ATTRIBUTES.payout.has('payout_processor_entries')).toBe(false)
    expect(BRIDGE_ATTRIBUTES.processor_balance_entry.get('processor_balance_page')).toBe(
      FieldType.JSON
    )
    expect(BRIDGE_ATTRIBUTES.customer_transaction.get('customer_transaction_order')).toBe(
      FieldType.RELATIONSHIP
    )
    expect(BRIDGE_ATTRIBUTES.customer_transaction.get('customer_transaction_test')).toBe(
      FieldType.CHECKBOX
    )
    // Order contributes only its payment-source block, not its whole field set.
    expect(
      [...BRIDGE_ATTRIBUTES.order.keys()].every((a) => a.startsWith('order_payment_source_'))
    ).toBe(true)
    expect(BRIDGE_ATTRIBUTES.order.get('order_payment_source_complete')).toBe(FieldType.CHECKBOX)
  })
})

describe('the typed column is chosen by the declared field type', () => {
  it('reads each column and unwraps a json envelope', () => {
    expect(readFieldValue(value({ valueText: 'po_1' }), FieldType.TEXT)).toBe('po_1')
    expect(readFieldValue(value({ valueNumber: 2 }), FieldType.NUMBER)).toBe(2)
    expect(readFieldValue(value({ valueBoolean: false }), FieldType.CHECKBOX)).toBe(false)
    expect(readFieldValue(value({ relatedEntityId: 'o1' }), FieldType.RELATIONSHIP)).toBe('o1')
    expect(readFieldValue(value({ valueJson: { v: { index: 0 } } }), FieldType.JSON)).toEqual({
      index: 0,
    })
    // Pre-envelope rows are the object itself.
    expect(readFieldValue(value({ valueJson: { index: 3 } }), FieldType.JSON)).toEqual({ index: 3 })
    expect(readFieldValue(value(), FieldType.JSON)).toBeNull()
  })
})

describe('the pivot', () => {
  it('resolves field ids from the cache and reads one batch in one query', async () => {
    h.fields.set('payout-def', [
      { id: 'f-ext', systemAttribute: 'payout_source_external_id' },
      { id: 'f-page', systemAttribute: 'payout_source_membership' },
      { id: 'f-other', systemAttribute: 'payout_number' },
      { id: 'f-custom', systemAttribute: null },
    ])
    const { entityDefinitionId, specs } = await bridgeFieldSpecs('org', 'payout')
    expect(entityDefinitionId).toBe('payout-def')
    expect([...specs.keys()]).toEqual(['f-ext', 'f-page'])

    h.rows = [
      { entityId: 'p1', fieldId: 'f-ext', ...value({ valueText: 'po_1' }) },
      { entityId: 'p1', fieldId: 'f-page', ...value({ valueJson: { v: { complete: true } } }) },
      { entityId: 'p2', fieldId: 'f-ext', ...value({ valueText: 'po_2' }) },
      { entityId: 'p2', fieldId: 'unknown', ...value({ valueText: 'ignored' }) },
    ]
    const pivot = await pivotRecordFields(fakeDb(), 'org', ['p1', 'p2'], specs)
    expect(h.selects).toBe(1)
    expect(pivot.get('p1')).toMatchObject({
      payout_source_external_id: 'po_1',
      payout_source_membership: { complete: true },
    })
    expect(pivot.get('p2')).toMatchObject({ payout_source_external_id: 'po_2' })
    expect(pivot.get('p2')).not.toHaveProperty('ignored')
    expect(pivot.get('p1')!.__updatedAt).toBe(Date.parse('2026-09-18T00:00:00.000Z'))
  })

  it('issues no query for an empty batch or an uninstalled resource', async () => {
    expect((await pivotRecordFields(fakeDb(), 'org', [], new Map())).size).toBe(0)
    expect((await pivotRecordFields(fakeDb(), 'org', ['p1'], new Map())).size).toBe(0)
    expect(h.selects).toBe(0)
  })
})

describe('the field-to-envelope mapping', () => {
  const now = new Date('2026-09-18T12:00:00.000Z')
  const payoutFields = {
    payout_source_external_id: 'po_1',
    payout_source_provider_key: 'shopify_payments',
    payout_source_account_id: 'shop-1',
    payout_source_environment: 'live',
    payout_source_acquisition_id: 'acq-1',
    payout_source_acquired_at: '2026-09-17T00:00:00Z',
    payout_source_amount: '97.00',
    payout_source_currency: 'USD',
    payout_source_currency_exponent: 2,
    payout_source_status: 'paid',
    payout_source_issued_on: '2026-09-17',
  }

  it('builds a payout envelope and defaults an unsupplied membership', () => {
    const evidence = storedFinancialFacts('payout', payoutFields, now)!
    expect(evidence).toMatchObject({
      version: 2,
      externalId: 'po_1',
      sourceAccount: {
        providerKey: 'shopify_payments',
        externalAccountId: 'shop-1',
        environment: 'live',
      },
      acquisition: { id: 'acq-1', startedAt: '2026-09-17T00:00:00Z' },
    })
    expect('payout' in evidence && evidence.payout).toMatchObject({
      id: 'po_1',
      amount: '97.00',
      currencyExponent: 2,
      issuedOn: '2026-09-17',
      issuedAt: null,
    })
    expect('membership' in evidence && evidence.membership).toMatchObject({
      providerReady: false,
      complete: false,
      entries: [],
    })
  })

  it('dates an acquisition from the record itself when the source reported none', () => {
    const {
      payout_source_acquisition_id: _id,
      payout_source_acquired_at: _at,
      ...rest
    } = payoutFields
    const evidence = storedFinancialFacts('payout', rest, now)!
    expect(evidence.acquisition.startedAt).toBe(now.toISOString())
    expect(evidence.acquisition.id).toMatch(/\w/)
  })

  it('returns null when an identity or an amount is missing', () => {
    expect(
      storedFinancialFacts('payout', { ...payoutFields, payout_source_provider_key: null }, now)
    ).toBeNull()
    expect(
      storedFinancialFacts('payout', { ...payoutFields, payout_source_amount: null }, now)
    ).toBeNull()
    // …unless the row is a retained rejection, which carries no amount by design.
    expect(
      storedFinancialFacts(
        'payout',
        { ...payoutFields, payout_source_amount: null, payout_source_rejection_reason: 'bad row' },
        now
      )
    ).toMatchObject({ payout: null, rejectionReason: 'bad row' })
  })

  it('builds a processor entry and falls back to a single-row page', () => {
    const evidence = storedFinancialFacts(
      'processor_balance_entry',
      {
        processor_balance_external_id: 'bt_1',
        processor_balance_provider_key: 'shopify_payments',
        processor_balance_account_id: 'shop-1',
        processor_balance_environment: 'live',
        processor_balance_acquisition_id: 'acq-1',
        processor_balance_acquired_at: '2026-09-17T00:00:00Z',
        processor_balance_type: 'charge',
        processor_balance_gross: '100.00',
        processor_balance_fee: '3.00',
        processor_balance_net: '97.00',
        processor_balance_currency: 'USD',
        processor_balance_currency_exponent: 2,
        processor_balance_payout_id: 'po_1',
      },
      now
    )!
    expect('page' in evidence && evidence.page).toEqual({ id: 'acq-1', index: 0, rowIndex: 0 })
    expect('entry' in evidence && evidence.entry).toMatchObject({
      id: 'bt_1',
      type: 'charge',
      providerType: 'charge',
      net: '97.00',
      payoutId: 'po_1',
      sourceTransactionId: null,
    })
  })

  it('returns null for a processor entry with no money and no rejection', () => {
    expect(
      storedFinancialFacts(
        'processor_balance_entry',
        {
          processor_balance_external_id: 'bt_1',
          processor_balance_provider_key: 'p',
          processor_balance_account_id: 'a',
          processor_balance_environment: 'live',
        },
        now
      )
    ).toBeNull()
  })
})
