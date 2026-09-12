// packages/lib/src/data-migrations/migrations/153-fulfillment-lines.test.ts
//
// Migration 153 is the richest shape in this directory: two new defs (149's
// shape) PLUS a field that changes TYPE under the same name (152's shape,
// but the old row has to be found and dropped first rather than merely
// added to). What actually goes wrong here:
//
//  - `order_fulfillments` keeps its systemAttribute, so `ensureCustomFields`'s
//    own existence check (keyed on entityDefinitionId + systemAttribute)
//    would see the OLD JSON row and skip creating the new RELATIONSHIP one
//    entirely, silently leaving the field the wrong type forever;
//  - the drop has to be gated on the stored `type`, or a re-run after this
//    migration already applied would delete the NEW field it just created;
//  - every has_many/belongs_to pair has to actually resolve - an unlinked
//    inverse is worse than a missing field (135's lesson);
//  - `fulfillment.shipment` is the one relationship in this migration that
//    is DELIBERATELY never linked, and the assertion list must not choke on
//    it;
//  - a new entity type is a hand-edit across several files, and a type
//    present in one registry and missing from its sibling silently seeds a
//    zero-field def (149's own test pins this same checklist).

import { ENTITY_DEFINITION_TYPES } from '@auxx/types/resource'
import { SYSTEM_ATTRIBUTES } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import { FulfillmentStatus } from '../../resources/registry/enum-values'
import { RESOURCE_FIELD_REGISTRY } from '../../resources/registry/field-registry'
import { FULFILLMENT_FIELDS } from '../../resources/registry/resources/fulfillment-fields'
import { FULFILLMENT_LINE_FIELDS } from '../../resources/registry/resources/fulfillment-line-fields'
import { LINE_ITEM_FIELDS } from '../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../resources/registry/resources/order-fields'
import { STOCK_MOVEMENT_FIELDS } from '../../resources/registry/resources/stock-movement-fields'
import { DISPLAY_FIELD_CONFIG, SYSTEM_ENTITIES } from '../../seed/entity-seeder/constants'
import { FIELD_REGISTRY } from '../../seed/entity-seeder/create-fields'
import { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } from '../registry'
import { migration153FulfillmentLines } from './153-fulfillment-lines'

const MIGRATION_ID = '153-fulfillment-lines'

describe('migration 153 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is the only migration claiming the number 153', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '153')).toHaveLength(1)
  })

  it('exports the migration it registers', () => {
    expect(PER_ORG_MIGRATIONS).toContain(migration153FulfillmentLines)
  })

  it('reaches the shared data-migration registry without an entry of its own, sorted by id', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe.each([
  ['fulfillment', 'fulfillments', FULFILLMENT_FIELDS],
  ['fulfillment_line', 'fulfillment-lines', FULFILLMENT_LINE_FIELDS],
] as const)('%s is registered everywhere a hidden def has to be', (type, apiSlug, fields) => {
  it('is an EntityDefinitionType, so a <type>:<id> RecordId canonicalizes', () => {
    expect(ENTITY_DEFINITION_TYPES).toContain(type)
  })

  it('resolves the SAME field map in both registries used by the two seeders', () => {
    // Object identity: `createAllFields` iterates FIELD_REGISTRY while
    // `createEntityDefinitions` iterates SYSTEM_ENTITIES, so a type in the
    // second and not the first lands on a new org as a definition with ZERO
    // fields, and UnifiedCrudHandler silently drops every value.
    expect(RESOURCE_FIELD_REGISTRY[type]).toBe(fields)
    expect(FIELD_REGISTRY[type]).toBe(fields)
  })

  it('is a HIDDEN SYSTEM_ENTITIES entry - no sidebar group, and no route folder', () => {
    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === type)
    expect(entity).toBeDefined()
    expect(entity?.apiSlug).toBe(apiSlug)
    expect(entity?.isVisible).toBe(false)
  })

  it('every field carries a systemAttribute in the shared union, and every sort order is distinct', () => {
    const orders: string[] = []
    for (const field of Object.values(fields)) {
      expect(SYSTEM_ATTRIBUTES).toContain(field.systemAttribute)
      if (typeof field.systemSortOrder === 'string') orders.push(field.systemSortOrder)
    }
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('displays as fields that exist on the def', () => {
    const config = DISPLAY_FIELD_CONFIG[type]
    expect(config).toBeDefined()
    expect(fields[config!.primaryDisplayField]).toBeDefined()
    expect(fields[config!.secondaryDisplayField!]).toBeDefined()
  })
})

describe('order_fulfillments keeps its name and changes type', () => {
  it('is a RELATIONSHIP has_many now, never JSON', () => {
    expect(ORDER_FIELDS.fulfillments?.systemAttribute).toBe('order_fulfillments')
    expect(ORDER_FIELDS.fulfillments?.fieldType).toBe('RELATIONSHIP')
    expect(ORDER_FIELDS.fulfillments?.type).not.toBe('json')
    expect(ORDER_FIELDS.fulfillments?.relationship).toMatchObject({
      inverseResourceFieldId: 'fulfillment:order',
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    })
  })

  it('points fulfillment.order at the inverse order.fulfillments declares, with no onDelete', () => {
    // A belongs_to never declares onDelete - the has_many side above owns
    // that answer, and the engine reads the STORED value copied from there.
    expect(FULFILLMENT_FIELDS.order?.relationship?.inverseResourceFieldId).toBe(
      'order:fulfillments'
    )
    expect(FULFILLMENT_FIELDS.order?.relationship?.relationshipType).toBe('belongs_to')
    expect(FULFILLMENT_FIELDS.order?.relationship?.onDelete).toBeUndefined()
    expect(FULFILLMENT_FIELDS.order?.nullable).toBe(false)
  })
})

describe('the relationship edges this migration must link', () => {
  it('cascades fulfillment.lines into fulfillment_line, and links the inverse', () => {
    expect(FULFILLMENT_FIELDS.lines?.relationship).toMatchObject({
      inverseResourceFieldId: 'fulfillment_line:fulfillment',
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    })
    expect(FULFILLMENT_LINE_FIELDS.fulfillment?.relationship?.inverseResourceFieldId).toBe(
      'fulfillment:lines'
    )
    expect(FULFILLMENT_LINE_FIELDS.fulfillment?.relationship?.onDelete).toBeUndefined()
  })

  it('unlinks line_item.fulfillmentLines rather than cascading', () => {
    // Mirrors line_item.creditMemoLines exactly - deleting a line item must
    // not delete the fulfillment lines that already shipped it.
    expect(LINE_ITEM_FIELDS.fulfillmentLines?.relationship).toMatchObject({
      inverseResourceFieldId: 'fulfillment_line:lineItem',
      relationshipType: 'has_many',
      onDelete: 'unlink',
      isInverse: true,
    })
    expect(FULFILLMENT_LINE_FIELDS.lineItem?.relationship?.inverseResourceFieldId).toBe(
      'line_item:fulfillmentLines'
    )
  })

  it('mirrors purchase_order_line.stockMovements for the sell side', () => {
    expect(FULFILLMENT_LINE_FIELDS.stockMovements?.relationship).toMatchObject({
      inverseResourceFieldId: 'stock_movement:fulfillmentLine',
      relationshipType: 'has_many',
      isInverse: true,
    })
    expect(STOCK_MOVEMENT_FIELDS.fulfillmentLine?.relationship?.inverseResourceFieldId).toBe(
      'fulfillment_line:stockMovements'
    )
    expect(STOCK_MOVEMENT_FIELDS.fulfillmentLine?.relationship?.onDelete).toBeUndefined()
    expect(STOCK_MOVEMENT_FIELDS.fulfillmentLine?.nullable).toBe(true)
    expect(STOCK_MOVEMENT_FIELDS.fulfillmentLine?.capabilities).toMatchObject({
      filterable: true,
      updatable: false,
    })
  })

  it('leaves fulfillment.shipment with no relationshipConfig and no resolvable inverse', () => {
    // Deliberately one-sided (brief §2.2): no field on `shipment` points back,
    // so this must never appear in a "must be linked" assertion list.
    expect(FULFILLMENT_FIELDS.shipment?.relationship?.relationshipType).toBe('belongs_to')
    expect(FULFILLMENT_FIELDS.shipment?.relationship?.inverseResourceFieldId).toBeNull()
    expect(FULFILLMENT_FIELDS.shipment?.relationship?.onDelete).toBeUndefined()
    expect(FULFILLMENT_FIELDS.shipment?.relationshipConfig).toBeUndefined()
    expect(FULFILLMENT_FIELDS.shipment?.nullable).toBe(true)
  })
})

describe('fulfillment_gl_posting is TEXT, exactly the credit_memo_gl_posting precedent', () => {
  it('is TEXT and NOT a relationship', () => {
    expect(FULFILLMENT_FIELDS.glPosting?.fieldType).toBe('TEXT')
    expect(FULFILLMENT_FIELDS.glPosting?.type).toBe('string')
    expect(FULFILLMENT_FIELDS.glPosting?.relationship).toBeUndefined()
    expect(FULFILLMENT_FIELDS.glPosting?.relationshipConfig).toBeUndefined()
  })

  it('says in its own description why it is not a relationship', () => {
    expect(FULFILLMENT_FIELDS.glPosting?.description ?? '').toMatch(/RELATIONSHIP/)
    expect(FULFILLMENT_FIELDS.glPosting?.description ?? '').toMatch(/EntityDefinition/)
  })

  it('is nullable, because the poster stamps it after the fact', () => {
    expect(FULFILLMENT_FIELDS.glPosting?.nullable).toBe(true)
  })
})

describe('FulfillmentStatus mirrors Shopify exactly, all six values', () => {
  it('carries all six lifecycle values, pending included', () => {
    const values = FulfillmentStatus.values.map((v) => v.value)
    expect(values).toEqual(['pending', 'open', 'success', 'cancelled', 'error', 'failure'])
  })

  it('binds fulfillment.status to the preset enum', () => {
    expect(FULFILLMENT_FIELDS.status?.fieldType).toBe('SINGLE_SELECT')
    expect(FULFILLMENT_FIELDS.status?.options?.options).toEqual(FulfillmentStatus.values)
    expect(FULFILLMENT_FIELDS.status?.nullable).toBe(false)
  })

  it('gives every value a label and a colour', () => {
    for (const item of FulfillmentStatus.values) {
      expect(item.label).toBeTruthy()
      expect(item.color).toBeTruthy()
    }
  })
})

describe('fulfillment_line carries no part, no date and no money', () => {
  it('has exactly the four business fields the brief allows', () => {
    const businessKeys = Object.keys(FULFILLMENT_LINE_FIELDS).filter(
      (k) => !['id', 'createdAt', 'updatedAt', 'createdBy'].includes(k)
    )
    expect(new Set(businessKeys)).toEqual(
      new Set(['fulfillment', 'lineItem', 'quantity', 'quantityRelieved', 'stockMovements'])
    )
  })

  it('makes quantityRelieved a computed, never-written roll-up', () => {
    expect(FULFILLMENT_LINE_FIELDS.quantityRelieved?.capabilities).toMatchObject({
      creatable: false,
      updatable: false,
      computed: true,
    })
  })
})
