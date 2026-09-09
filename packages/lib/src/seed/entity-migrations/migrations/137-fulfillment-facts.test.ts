// packages/lib/src/seed/entity-migrations/migrations/137-fulfillment-facts.test.ts

import { SYSTEM_ATTRIBUTES } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { FIELD_REGISTRY } from '../../entity-seeder/create-fields'
import { ALL_ENTITY_MIGRATIONS } from '../index'
import { migration137FulfillmentFacts } from './137-fulfillment-facts'

/** The three attributes this migration exists to materialise. */
const ATTRIBUTES = [
  'line_item_fulfilled_at',
  'line_item_fulfilled_qty',
  'line_item_shipment_count',
] as const

describe('migration 137 registration', () => {
  it('is registered exactly once, after 136, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '137-fulfillment-facts')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf('137-fulfillment-facts')).toBeGreaterThan(
      ids.indexOf('136-refunds-and-tax-lines')
    )
    expect(migration137FulfillmentFacts.id).toBe('137-fulfillment-facts')
  })

  it('names both halves of what it does in its description', () => {
    expect(migration137FulfillmentFacts.description).toContain('line_item_fulfilled_at')
    expect(migration137FulfillmentFacts.description).toContain('clearing_affirm')
  })
})

describe('the three fulfillment facts in the registry', () => {
  it('exists on line_item under the keys the migration picks', () => {
    // 🛑 The migration resolves these by REGISTRY KEY and throws when one is
    // missing, so a rename that is not made here too fails the migration on
    // every org rather than silently materialising nothing.
    for (const key of ['fulfilledAt', 'fulfilledQty', 'shipmentCount'] as const) {
      expect(LINE_ITEM_FIELDS[key]).toBeDefined()
    }
    expect(LINE_ITEM_FIELDS.fulfilledAt?.systemAttribute).toBe('line_item_fulfilled_at')
    expect(LINE_ITEM_FIELDS.fulfilledQty?.systemAttribute).toBe('line_item_fulfilled_qty')
    expect(LINE_ITEM_FIELDS.shipmentCount?.systemAttribute).toBe('line_item_shipment_count')
  })

  it('is in the SystemAttribute union', () => {
    // Without this a stored `CustomField.systemAttribute` is a string the type
    // system does not know, and every consumer that keys off the union - the
    // finalize pass's trigger set included - silently matches nothing.
    for (const attribute of ATTRIBUTES) {
      expect(SYSTEM_ATTRIBUTES).toContain(attribute)
    }
  })

  it('is nullable, writable by a connector, and hidden from every surface', () => {
    for (const key of ['fulfilledAt', 'fulfilledQty', 'shipmentCount'] as const) {
      const field = LINE_ITEM_FIELDS[key]!
      // Null means "the channel said nothing", which is not zero and not one.
      expect(field.nullable).toBe(true)
      expect(field.capabilities?.creatable).toBe(true)
      expect(field.capabilities?.updatable).toBe(true)
      expect(field.showInPanel).toBe(false)
      expect(field.showInTable).toBe(false)
      expect(field.showInDialogs).toBe(false)
      expect(field.description).toContain('sales channel')
    }
  })

  it('reaches a FRESH org through the seeder without the migration', () => {
    // `FIELD_REGISTRY.line_item` IS `LINE_ITEM_FIELDS`, so a new org gets all
    // three from `createFields`. The migration is only for orgs that already
    // exist - which is the half that is easy to forget in the other direction.
    expect(FIELD_REGISTRY.line_item).toBe(LINE_ITEM_FIELDS)
  })
})
