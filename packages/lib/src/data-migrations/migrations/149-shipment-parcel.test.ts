// packages/lib/src/data-migrations/migrations/149-shipment-parcel.test.ts
//
// A new entity type is a hand-edit across several files (`enums.ts`,
// `enum-values.ts`, `field-registry.ts`, `create-fields.ts`, `constants.ts`,
// `types/resource/utils.ts`, the system-attribute union, the SDK union), and
// getting one wrong creates a def the app can half see: the records path
// resolves it and the seeder does not, or the reverse. 146's test pins that
// checklist for `payment_gateway`; this pins it for BOTH halves of
// `plans/apps/shipstation/shared-shipment-entities-proposal.md`, and adds the
// thing that proposal makes load-bearing: the relationship edges and their
// `onDelete` answers.

import { ModelTypeMeta, ModelTypes, ModelTypeValues } from '@auxx/database/enums'
import { ENTITY_DEFINITION_TYPES } from '@auxx/types/resource'
import { SYSTEM_ATTRIBUTES } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import { ParcelTrackingStatus, ShipmentStatus } from '../../resources/registry/enum-values'
import { RESOURCE_FIELD_REGISTRY } from '../../resources/registry/field-registry'
import { ORDER_FIELDS } from '../../resources/registry/resources/order-fields'
import { PARCEL_FIELDS } from '../../resources/registry/resources/parcel-fields'
import { SHIPMENT_FIELDS } from '../../resources/registry/resources/shipment-fields'
import { DISPLAY_FIELD_CONFIG, SYSTEM_ENTITIES } from '../../seed/entity-seeder/constants'
import { FIELD_REGISTRY } from '../../seed/entity-seeder/create-fields'
import { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } from '../registry'
import { migration149ShipmentParcel } from './149-shipment-parcel'

const MIGRATION_ID = '149-shipment-parcel'

describe('migration 149 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('leaves every registered id on a distinct number, and 149 is its own', () => {
    const numbers = PER_ORG_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(PER_ORG_MIGRATIONS.filter((m) => m.id.split('-')[0] === '149')).toHaveLength(1)
  })

  it('exports the migration it registers', () => {
    expect(PER_ORG_MIGRATIONS).toContain(migration149ShipmentParcel)
  })

  it('reaches the shared data-migration registry without an entry of its own', () => {
    // `buildRegistry` spreads `PER_ORG_MIGRATIONS.map(perOrgMigration)`,
    // so registering above is the whole job. A hand-written entry in
    // `data-migrations/registry.ts` would be a DUPLICATE id, which
    // `assertUniqueMigrationIds` throws on at module load.
    expect(ALL_DATA_MIGRATIONS.filter((m) => m.id === MIGRATION_ID)).toHaveLength(1)
  })

  it('sorts into the registry by id', () => {
    // 107, which created the order def this migration widens, has since been retired —
    // the ordering guarantee now rests on the registry's own id sort.
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThanOrEqual(0)
  })
})

describe.each([
  ['shipment', 'shipments', 'Shipment', SHIPMENT_FIELDS],
  ['parcel', 'parcels', 'Parcel', PARCEL_FIELDS],
] as const)('%s is registered everywhere a def has to be', (type, apiSlug, singular, fields) => {
  it('is a ModelTypeValues entry, mapped in ModelTypes, with EntityInstance meta', () => {
    expect(ModelTypeValues).toContain(type)
    expect(ModelTypes[type.toUpperCase() as 'SHIPMENT' | 'PARCEL']).toBe(type)
    expect(ModelTypeMeta[type].apiSlug).toBe(apiSlug)
    expect(ModelTypeMeta[type].label).toBe(singular)
    expect(ModelTypeMeta[type].dbTable).toBe('EntityInstance')
    // No `/app/shipments/[id]` or `/app/parcels/[id]` route exists; claiming
    // one puts a fullscreen button on the drawer that 404s.
    expect(ModelTypeMeta[type].hasDetailPage).toBe(false)
  })

  it('is an EntityDefinitionType, so a <type>:<id> RecordId canonicalizes', () => {
    expect(ENTITY_DEFINITION_TYPES).toContain(type)
  })

  it('resolves the SAME field map in both registries used by the two seeders', () => {
    // Object identity, not deep equality: `createAllFields` iterates
    // FIELD_REGISTRY while `createEntityDefinitions` iterates SYSTEM_ENTITIES,
    // so a type in the second and not the first lands on a new org as a
    // definition with ZERO fields and `UnifiedCrudHandler` silently drops every
    // value with only a logged warning. `bank_rule` shipped that way.
    expect(RESOURCE_FIELD_REGISTRY[type]).toBe(fields)
    expect(FIELD_REGISTRY[type]).toBe(fields)
  })

  it('is a HIDDEN SYSTEM_ENTITIES entry - no sidebar group, and no route folder', () => {
    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === type)
    expect(entity).toBeDefined()
    expect(entity?.apiSlug).toBe(apiSlug)
    expect(entity?.isVisible).toBe(false)
  })

  it('every field carries a systemAttribute in the shared union', () => {
    for (const field of Object.values(fields)) {
      expect(SYSTEM_ATTRIBUTES).toContain(field.systemAttribute)
    }
  })

  it('displays as fields that exist on the def', () => {
    const config = DISPLAY_FIELD_CONFIG[type]
    expect(config).toBeDefined()
    expect(fields[config!.primaryDisplayField]).toBeDefined()
    expect(fields[config!.secondaryDisplayField!]).toBeDefined()
  })
})

describe('the fields the proposal makes load-bearing', () => {
  it('names BOTH by a tracking number, and the shipment NOT by its number', () => {
    // The shipment's display is the master tracking number, not
    // `shipment_number`. Two reasons, both from the provider rather than from
    // what would read nicely:
    //
    //  1. `shipment_number` is not on the label payload at all - it lives on the
    //     shipment resource - so the label stream left it empty on 135 of 135
    //     shipments in the first real sync and every one rendered nameless.
    //  2. ShipStation documents it as "optional, mutable, and does not require
    //     uniqueness", so it is not something to lean on.
    //
    // The master tracking number filled 135 of 135 in that same sync, and it is
    // what a support agent actually arrives holding.
    expect(DISPLAY_FIELD_CONFIG.shipment?.primaryDisplayField).toBe('masterTrackingNumber')
    expect(DISPLAY_FIELD_CONFIG.shipment?.primaryDisplayField).not.toBe('number')
    expect(DISPLAY_FIELD_CONFIG.parcel?.primaryDisplayField).toBe('trackingNumber')
  })

  it('denormalizes the master tracking number onto the shipment, never matching on it', () => {
    const f = SHIPMENT_FIELDS.masterTrackingNumber
    expect(f).toBeDefined()
    expect(f?.systemAttribute).toBe('shipment_master_tracking_number')
    expect(f?.fieldType).toBe('TEXT')
    // Nullable: the provider guarantees nothing, and `shipment_number` is the
    // cautionary tale for arguing a requirement from "it is the display field".
    expect(f?.nullable).toBe(true)
    // It CHANGES on a void-and-reprint, so it can never be an identity.
    expect(f?.type).not.toBe('RELATION')
  })

  it('requires the parcel tracking number and NOT the shipment number', () => {
    // Asymmetric on purpose, and both halves come from the provider rather than
    // from what would be convenient for the display.
    //
    // A parcel without a tracking number is not a parcel: the number is the
    // cross-app match key every carrier app converges on.
    //
    // `shipment_number` is the merchant's ORDER number, and ShipStation
    // documents it as "optional, mutable, and does not require uniqueness".
    // Requiring it would be auxx inventing a constraint the source does not
    // have - and the label stream does not even carry the field, so every
    // synced shipment would violate it.
    expect(PARCEL_FIELDS.trackingNumber?.nullable).toBe(false)
    expect(SHIPMENT_FIELDS.number?.nullable).toBe(true)
  })

  it('keeps parcel_tracking_number a plain native TEXT column, the only legal match key', () => {
    // §4: `buildContributingMatchBindings` binds a native `target` column only,
    // so a provider id held in an APP field can never be a cross-app join key.
    // This is why convergence goes through this column and not ShipStation's
    // `label_id:package_id` external id.
    expect(PARCEL_FIELDS.trackingNumber?.fieldType).toBe('TEXT')
    expect(PARCEL_FIELDS.trackingNumber?.systemAttribute).toBe('parcel_tracking_number')
    expect(PARCEL_FIELDS.trackingNumber?.nullable).toBe(false)
  })

  it('leaves every carrier-owned status field nullable, because neither app has a connector', () => {
    // §5 and the §8 decision: FedEx and UPS get connectors later, so these have
    // no writer in the first pass. Null is the expected state, not a gap.
    for (const key of [
      'status',
      'statusCode',
      'statusDescription',
      'estimatedDelivery',
      'deliveredAt',
      'receivedBy',
    ]) {
      expect(PARCEL_FIELDS[key]?.nullable).toBe(true)
    }
  })

  it('carries the label lifecycle in booleans, never inside the status enum', () => {
    // §6: a void and reprint becomes lifecycle on the parcel plus new parcel
    // rows, which is what lets one shared vocabulary serve both grains instead
    // of the two-axis split `PurchaseOrderStatus` warns about.
    expect(PARCEL_FIELDS.voided?.fieldType).toBe('CHECKBOX')
    expect(PARCEL_FIELDS.voidedAt?.fieldType).toBe('DATETIME')
    const parcelValues = ParcelTrackingStatus.values.map((v) => v.value)
    expect(parcelValues).not.toContain('voided')
    expect(parcelValues).not.toContain('label_voided')
  })

  it('keeps the unit fields, because ShipStation reports ounces and inches', () => {
    expect(PARCEL_FIELDS.weightUnit).toBeDefined()
    expect(PARCEL_FIELDS.dimUnit).toBeDefined()
  })
})

describe('the relationship edges', () => {
  it('gives shipment.parcels the cascade, and parcel.shipment no onDelete at all', () => {
    // A belongs_to never declares anything: the has_many side owns the answer
    // and the engine reads the STORED value copied from there.
    expect(SHIPMENT_FIELDS.parcels?.relationship).toMatchObject({
      inverseResourceFieldId: 'parcel:shipment',
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    })
    expect(PARCEL_FIELDS.shipment?.relationship?.relationshipType).toBe('belongs_to')
    expect(PARCEL_FIELDS.shipment?.relationship?.onDelete).toBeUndefined()
    expect(PARCEL_FIELDS.shipment?.relationshipConfig?.relatedEntityType).toBe('shipment')
  })

  it('unlinks order.shipments rather than cascading, so deleting an order keeps the boxes', () => {
    // Owner's call: a shipment is a physical dispatch ShipStation minted and
    // still owns. Contrast `order.creditMemos`, which cascades because a channel
    // credit memo is fanned out of the order payload and has no life without it.
    expect(ORDER_FIELDS.shipments?.relationship).toMatchObject({
      inverseResourceFieldId: 'shipment:order',
      relationshipType: 'has_many',
      onDelete: 'unlink',
      isInverse: true,
    })
    expect(ORDER_FIELDS.creditMemos?.relationship?.onDelete).toBe('cascade')
  })

  it('points shipment.order at the inverse order.shipments declares', () => {
    expect(SHIPMENT_FIELDS.order?.relationship?.inverseResourceFieldId).toBe('order:shipments')
    expect(SHIPMENT_FIELDS.order?.relationship?.relationshipType).toBe('belongs_to')
    expect(SHIPMENT_FIELDS.order?.relationshipConfig?.inverseSystemAttribute).toBe(
      'order_shipments'
    )
    // Declared but not yet populatable (§4): `linkMode: 'reference'` cannot
    // cross connectors, so this stays null until a native match or the
    // platform resolver lands. Nullable is what makes that survivable.
    expect(SHIPMENT_FIELDS.order?.nullable).toBe(true)
  })

  it('gives order.shipments a sortOrder that collides with no other order field', () => {
    const orders = Object.values(ORDER_FIELDS)
      .map((f) => f.systemSortOrder)
      .filter((s): s is string => typeof s === 'string')
    expect(new Set(orders).size).toBe(orders.length)
  })
})

describe('the shared status vocabulary', () => {
  const PARCEL_VALUES = [
    'label_created',
    'picked_up',
    'in_transit',
    'out_for_delivery',
    'ready_for_pickup',
    'attempted_delivery',
    'delayed',
    'delivered',
    'exception',
    'returned_to_shipper',
    'unknown',
  ]

  it('lists exactly the eleven ParcelTrackingStatus values', () => {
    expect(ParcelTrackingStatus.values.map((v) => v.value)).toEqual(PARCEL_VALUES)
  })

  it('is ShipmentStatus plus partially_delivered, the one state a single box cannot be in', () => {
    const shipmentValues = ShipmentStatus.values.map((v) => v.value)
    expect(shipmentValues).toContain('partially_delivered')
    expect(new Set(shipmentValues)).toEqual(new Set([...PARCEL_VALUES, 'partially_delivered']))
  })

  it('carries an explicit unknown case in both, so nothing has to be guessed', () => {
    // §8d rule 2: anything the connector does not recognise maps here, never to
    // a guess. That is the whole reason the case exists.
    expect(ParcelTrackingStatus.values.map((v) => v.value)).toContain('unknown')
    expect(ShipmentStatus.values.map((v) => v.value)).toContain('unknown')
  })

  it('binds both status fields to their preset enum', () => {
    expect(PARCEL_FIELDS.status?.fieldType).toBe('SINGLE_SELECT')
    expect(PARCEL_FIELDS.status?.options?.options).toBe(ParcelTrackingStatus.values)
    expect(SHIPMENT_FIELDS.status?.fieldType).toBe('SINGLE_SELECT')
    expect(SHIPMENT_FIELDS.status?.options?.options).toBe(ShipmentStatus.values)
  })

  it('gives every value a label and a colour', () => {
    for (const item of [...ParcelTrackingStatus.values, ...ShipmentStatus.values]) {
      expect(item.label).toBeTruthy()
      expect(item.color).toBeTruthy()
    }
  })
})
