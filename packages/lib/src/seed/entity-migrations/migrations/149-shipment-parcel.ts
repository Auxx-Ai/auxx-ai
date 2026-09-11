// packages/lib/src/seed/entity-migrations/migrations/149-shipment-parcel.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { ResourceField } from '../../../resources/registry/field-types'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { PARCEL_FIELDS } from '../../../resources/registry/resources/parcel-fields'
import { SHIPMENT_FIELDS } from '../../../resources/registry/resources/shipment-fields'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:149')

/** What {@link ensureCustomFields} returns, keyed `<entityType>:<field id>`. */
type EnsuredFieldMap = Awaited<ReturnType<typeof ensureCustomFields>>

/** The two defs this migration creates. Both hidden, both with no route folder. */
const NEW_ENTITY_TYPES = ['shipment', 'parcel'] as const

/** The registry field map for each new def. */
const NEW_DEF_FIELDS: Record<string, Record<string, ResourceField>> = {
  shipment: SHIPMENT_FIELDS,
  parcel: PARCEL_FIELDS,
}

/**
 * Every relationship half this migration must LINK, paired with the inverse it
 * points at.
 *
 * Checked explicitly after {@link linkNewRelationships} rather than trusted,
 * because that helper only logs a DEBUG line when it cannot resolve an inverse.
 * Entity migration 135 is why, and 136 restates it: an UNLINKED relationship is
 * worse than a missing one. The field exists so writes are accepted, but with no
 * inverse the other side reads empty and every consumer silently sees nothing.
 *
 * Both halves of each pair are listed. `shipment_parcels` is the edge the delete
 * engine acts on, so an unlinked `parcel.shipment` would also mean a deleted
 * shipment leaves its parcels behind.
 */
const RELATIONSHIP_PAIRS: readonly { owning: string; inverse: string }[] = [
  { owning: `parcel:${PARCEL_FIELDS.shipment?.id}`, inverse: 'shipment:parcels' },
  { owning: `shipment:${SHIPMENT_FIELDS.parcels?.id}`, inverse: 'parcel:shipment' },
  { owning: `shipment:${SHIPMENT_FIELDS.order?.id}`, inverse: 'order:shipments' },
  { owning: `order:${ORDER_FIELDS.shipments?.id}`, inverse: 'shipment:order' },
]

/**
 * A new def and a new field are invisible to every read path that serves them
 * until the org's caches are dropped. `runEntityMigrationsForOrg` does this after
 * the whole batch, but `up()` can also be called directly.
 */
const CACHE_KEYS = ['entityDefs', 'entityDefSlugs', 'customFields', 'resources'] as const

/**
 * Migration 149: the `shipment` and `parcel` defs, their fields, and the
 * `order_shipments` inverse
 * (`plans/apps/shipstation/shared-shipment-entities-proposal.md` §7).
 *
 * ## Why this migration is the whole point
 *
 * `ensureEntityDefinitions` is a plain insert that skips any org already holding
 * the def, so `SYSTEM_ENTITIES` and `FIELD_REGISTRY` alone reach FRESH orgs and
 * nothing else. This is what reaches the ones that already exist, and the SDK's
 * `EntityRefKind` union depends on it: its standing condition is that every kind
 * in it be seeded into EXISTING orgs by a migration, because `provisionAppField`
 * warns-and-skips when `getCachedEntityDefId` returns nothing, and an app author
 * who declares a field against an unseeded kind sees no error and gets nothing.
 *
 * Registered in `entity-migrations/index.ts`, which is also what puts it in the
 * shared `ALL_DATA_MIGRATIONS` registry: `buildRegistry` spreads
 * `ALL_ENTITY_MIGRATIONS.map(wrapEntityMigration)`, so a hand-written entry
 * there would be a duplicate id that `assertUniqueMigrationIds` throws on at
 * module load.
 *
 * ## What it adds
 *
 * - **`shipment`** - one dispatch of goods: number, carrier, service, ship date,
 *   parcel count, its parcels, and the order it belongs to.
 * - **`parcel`** - one physical box with one tracking number: sequence, master
 *   flag, weight, dimensions, void state, and the carrier status fields.
 * - **`order_shipments`** - the has_many inverse of `shipment_order`, on a def
 *   that already exists.
 *
 * ## Why native rather than app-owned (proposal §2)
 *
 * Three apps know different things about the same object: ShipStation knows what
 * was dispatched, FedEx and UPS know where each parcel is, Shopify knows which
 * order it belongs to. `apps/fedex/.../shipment-schema.ts` and its UPS twin
 * already declare a byte-for-byte identical parcel shape, and ShipStation would
 * be a third copy. App-owned entities would make that a third TABLE as well,
 * with no way to join a ShipStation box to the FedEx status of that same box.
 *
 * ## Both defs are HIDDEN
 *
 * `isVisible: false` in `SYSTEM_ENTITIES`, which `ensureEntityDefinitions` reads
 * from directly here rather than restating (the pattern in 146, so the two halves
 * cannot disagree). That flag suppresses four gates: the Records sidebar group,
 * the kbar create action, the kbar record-search scope and the AI entity catalog.
 * It suppresses NOTHING on the server, and the list page is absent because no
 * route folder was authored, not because anything declares it hidden. The
 * custom-fields settings screen is a separate hard-coded list and both types are
 * named there too.
 *
 * ## No writers
 *
 * This lands with nothing writing to either def. The ShipStation connector comes
 * next, and the carrier apps after that. `parcel_status` simply stays null until
 * FedEx or UPS has a connector, which is expected rather than a gap.
 *
 * ## Ordering
 *
 * MUST sort after 107, which creates `order`. An org short of it is a SKIP, not
 * a failure: the seeder creates all of this with the rest of the registry.
 *
 * Idempotent: `ensureEntityDefinitions` and `ensureCustomFields` are INSERT-only
 * and skip whatever the org already holds, and `linkNewRelationships` only writes
 * an inverse that is currently unset.
 */
export const migration149ShipmentParcel: EntityMigration = {
  id: '149-shipment-parcel',
  description:
    'Adds the hidden shipment and parcel defs with their fields and the order_shipments ' +
    'inverse - one dispatch of goods and one physical box with one tracking number, native ' +
    'rather than app-owned so ShipStation can contribute structure and the carrier apps can ' +
    'contribute status to the same row (shared-shipment-entities-proposal.md)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const existing = await loadExistingState(db, organizationId)

    // Absent rather than failed: an org short of 107 has no `order`, and the
    // seeder creates all of this with the rest of the registry.
    const orderDef = existing.entityDefs.get('order')
    if (!orderDef) {
      return { ...state, alreadyUpToDate: true }
    }

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => (NEW_ENTITY_TYPES as readonly string[]).includes(e.entityType)),
      existing,
      state
    )
    entityDefIds.set('order', orderDef.id)

    // 🛑 ONE field map spanning both new defs AND the widened `order`.
    // `linkNewRelationships` resolves an inverse out of this map by
    // `<entityType>:<field id>`, so linking the halves of a pair in separate
    // calls would leave each unable to see the other and skip the pair with
    // nothing louder than a debug line (the 135 lesson, restated by 136).
    const fieldMap: EnsuredFieldMap = new Map()

    for (const entityType of NEW_ENTITY_TYPES) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      const created = await ensureCustomFields(
        db,
        organizationId,
        entityType,
        defId,
        NEW_DEF_FIELDS[entityType]!,
        existing,
        state
      )
      for (const [key, value] of created) fieldMap.set(key, value)
    }

    const orderShipments = ORDER_FIELDS.shipments
    if (!orderShipments) {
      throw new Error('order registry is missing the key "shipments" (migration 149)')
    }
    const widenedOrder = await ensureCustomFields(
      db,
      organizationId,
      'order',
      orderDef.id,
      { shipments: orderShipments },
      existing,
      state
    )
    for (const [key, value] of widenedOrder) fieldMap.set(key, value)

    await linkNewRelationships(db, fieldMap, entityDefIds, state)
    await assertInversesLinked(db, fieldMap)

    await linkDisplayFields(db, [...NEW_ENTITY_TYPES], entityDefIds, fieldMap)

    const changed =
      state.entityDefsCreated > 0 || state.fieldsCreated > 0 || state.relationshipsLinked > 0

    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 149 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

/**
 * Fail loudly when a relationship half was created but never linked.
 *
 * `linkNewRelationships` skips an unresolvable inverse with a debug line, which
 * on this migration would mean a `shipment` that accepts parcel writes nobody can
 * read back, and a delete engine that cannot see the `cascade` edge it is meant
 * to act on.
 */
async function assertInversesLinked(
  db: Database,
  fieldMap: Map<string, { id: string }>
): Promise<void> {
  for (const { owning, inverse } of RELATIONSHIP_PAIRS) {
    const field = fieldMap.get(owning)
    if (!field) {
      throw new Error(`migration 149 could not resolve the field ${owning}`)
    }
    const row = await db.query.CustomField.findFirst({
      where: eq(schema.CustomField.id, field.id),
      columns: { options: true },
    })
    const inverseId = (row?.options as { relationship?: { inverseResourceFieldId?: string } })
      ?.relationship?.inverseResourceFieldId
    if (!inverseId) {
      throw new Error(
        `migration 149 created ${owning} but could not link it to ${inverse} - the inverse half ` +
          'is missing, and an unlinked relationship writes rows the other side cannot see'
      )
    }
  }
}
