// packages/lib/src/data-migrations/migrations/153-fulfillment-lines.ts

import { type Database, schema } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { FULFILLMENT_FIELDS } from '../../resources/registry/resources/fulfillment-fields'
import { FULFILLMENT_LINE_FIELDS } from '../../resources/registry/resources/fulfillment-line-fields'
import { LINE_ITEM_FIELDS } from '../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../resources/registry/resources/order-fields'
import { STOCK_MOVEMENT_FIELDS } from '../../resources/registry/resources/stock-movement-fields'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../../seed/entity-helpers'
import { SYSTEM_ENTITIES } from '../../seed/entity-seeder/constants'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:153')

/** What {@link ensureCustomFields} returns, keyed `<entityType>:<field id>`. */
type EnsuredFieldMap = Awaited<ReturnType<typeof ensureCustomFields>>

/** The two defs this migration creates. Both hidden, both with no route folder. */
const NEW_ENTITY_TYPES = ['fulfillment', 'fulfillment_line'] as const

/** The registry field map for each new def. */
const NEW_DEF_FIELDS: Record<string, Record<string, ResourceField>> = {
  fulfillment: FULFILLMENT_FIELDS,
  fulfillment_line: FULFILLMENT_LINE_FIELDS,
}

const ORDER_FULFILLMENTS_ATTRIBUTE = 'order_fulfillments'

/**
 * Every relationship half this migration must LINK, paired with the inverse it
 * points at.
 *
 * Checked explicitly after {@link linkNewRelationships} rather than trusted,
 * because that helper only logs a DEBUG line when it cannot resolve an inverse
 * - the 135 lesson, restated by 136 and by 149's own copy of this list. An
 * UNLINKED relationship is worse than a missing one: the field exists so
 * writes are accepted, but with no inverse the other side reads empty and
 * every consumer silently sees nothing.
 *
 * 🛑 `fulfillment:shipment` is DELIBERATELY ABSENT from this list. Per the
 * brief's §2.2, that edge is a one-sided, opportunistic pointer with no
 * inverse field on `shipment` at all - see `fulfillment-fields.ts`'s docblock
 * on that field for why it is safe to leave unresolved forever.
 */
const RELATIONSHIP_PAIRS: readonly { owning: string; inverse: string }[] = [
  { owning: `fulfillment:${FULFILLMENT_FIELDS.order?.id}`, inverse: 'order:fulfillments' },
  { owning: `order:${ORDER_FIELDS.fulfillments?.id}`, inverse: 'fulfillment:order' },
  {
    owning: `fulfillment:${FULFILLMENT_FIELDS.lines?.id}`,
    inverse: 'fulfillment_line:fulfillment',
  },
  {
    owning: `fulfillment_line:${FULFILLMENT_LINE_FIELDS.fulfillment?.id}`,
    inverse: 'fulfillment:lines',
  },
  {
    owning: `fulfillment_line:${FULFILLMENT_LINE_FIELDS.lineItem?.id}`,
    inverse: 'line_item:fulfillmentLines',
  },
  {
    owning: `line_item:${LINE_ITEM_FIELDS.fulfillmentLines?.id}`,
    inverse: 'fulfillment_line:lineItem',
  },
  {
    owning: `fulfillment_line:${FULFILLMENT_LINE_FIELDS.stockMovements?.id}`,
    inverse: 'stock_movement:fulfillmentLine',
  },
  {
    owning: `stock_movement:${STOCK_MOVEMENT_FIELDS.fulfillmentLine?.id}`,
    inverse: 'fulfillment_line:stockMovements',
  },
]

/**
 * A new def and a new field are invisible to every read path that serves them
 * until the org's caches are dropped. `perOrgMigration` does this after the
 * whole batch, but `up()` can also be called directly.
 */
const CACHE_KEYS = ['entityDefs', 'entityDefSlugs', 'customFields', 'resources'] as const

/** What migration 153 reports on top of the shared counters. */
export interface Migration153Result extends PerOrgMigrationResult {
  /** Whether the OLD `order_fulfillments` JSON field was found and dropped. */
  oldFulfillmentsFieldDropped: boolean
}

/**
 * Migration 153: the `fulfillment` and `fulfillment_line` defs, their fields,
 * and `order_fulfillments` reborn as a RELATIONSHIP under the same name
 * (`plans/money/tasks/55-shipment-lines.md`).
 *
 * ## Why this migration is the whole point
 *
 * `ensureEntityDefinitions` / `ensureCustomFields` are plain inserts that skip
 * whatever an org already holds, so `SYSTEM_ENTITIES` and `FIELD_REGISTRY`
 * alone reach FRESH orgs and nothing else. This is what reaches the ones that
 * already exist.
 *
 * ## The JSON field is DROPPED, not migrated in place
 *
 * `order_fulfillments` KEEPS ITS NAME (the owner's call, brief header) but
 * changes type from JSON to RELATIONSHIP has_many. `ensureCustomFields` keys
 * its "does this field already exist" check on
 * `(entityDefinitionId, systemAttribute)` - the same key the OLD field
 * occupies - so simply calling it would see the old row and skip creating the
 * new shape entirely. This migration therefore finds and DELETES the old
 * `CustomField` row FIRST, whenever its stored `type` is not already
 * `RELATIONSHIP` (idempotency: a re-run after this migration already applied
 * finds the new shape and leaves it alone).
 *
 * `FieldValue.fieldId -> CustomField.id` is ON DELETE CASCADE (verified
 * against the live schema), so deleting the `CustomField` row takes every
 * value with it. This migration does NOT delete `FieldValue` rows itself -
 * doing so would be redundant with the cascade and is explicitly the brief's
 * instruction.
 *
 * 🛑 This is a genuine DATA LOSS step, by design (brief §4.3, owner
 * 2026-09-11: *"our quickbooks connection is a sandbox... we can reset our
 * whole accounting right now if needed to"*). The runbook this migration
 * assumes is: reset accounting on any org with posted fulfillment GL entries,
 * THEN run this migration, THEN re-run the Shopify connector. This migration
 * does not reset accounting itself and does not check for posted entries -
 * that is an operational precondition, not something a schema migration can
 * safely decide on an org's behalf.
 *
 * ## What it adds
 *
 * - **`fulfillment`** - one dispatch of goods, everything the JSON entry
 *   carried, because revenue posts from it now.
 * - **`fulfillment_line`** - one `(fulfillment, line_item)` tuple: units of one
 *   order line that went out in one dispatch.
 * - **`order.fulfillments`** - `order_fulfillments` reborn as a has_many, the
 *   inverse of `fulfillment.order`.
 * - **`line_item.fulfillmentLines`** - the has_many inverse of
 *   `fulfillment_line.lineItem` - "where did this line's units go".
 * - **`stock_movement.fulfillmentLine`** - the belongs_to that carries all of
 *   task 50's inventory-relief netting, mirroring
 *   `stock_movement.purchaseOrderLine`.
 *
 * ## Both new defs are HIDDEN
 *
 * `isVisible: false` in `SYSTEM_ENTITIES`, read from directly here rather than
 * restated (the 146/149 pattern, so the two halves cannot disagree). No route
 * folder was authored, so the list page is absent by omission, not by
 * declaration.
 *
 * ## No writers yet
 *
 * This lands with nothing writing to either def. The connector and
 * `money.fulfillOrder` changes are separate work; this migration is the
 * registry contract they build against.
 *
 * ## Ordering
 *
 * MUST sort after 107 (`order`), the def whose absence marks an org that has
 * not been seeded from the current registry at all. An org short of it, or of
 * `line_item` / `stock_movement`, is a SKIP, not a failure - the seeder
 * creates all of this together from the registry.
 *
 * Idempotent: `ensureEntityDefinitions` and `ensureCustomFields` are
 * INSERT-only and skip whatever the org already holds, `linkNewRelationships`
 * only writes an inverse that is currently unset, and the old-field drop is
 * gated on the stored `type` still being JSON.
 */
export const migration153FulfillmentLines: PerOrgMigration = {
  id: '153-fulfillment-lines',
  description:
    'Adds the hidden fulfillment and fulfillment_line defs with their fields, drops the old ' +
    'order_fulfillments JSON field and recreates it under the same name as a RELATIONSHIP ' +
    'has_many, and adds the line_item / stock_movement inverses - so revenue posts from ' +
    'records instead of a collapsed JSON log (plans/money/tasks/55-shipment-lines.md)',

  async up(db: Database, organizationId: string): Promise<Migration153Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    let existing = await loadExistingState(db, organizationId)

    // Absent rather than failed: an org short of any of these three has not
    // been seeded from the current registry at all, and the seeder creates
    // everything below together from it.
    const orderDef = existing.entityDefs.get('order')
    const lineItemDef = existing.entityDefs.get('line_item')
    const stockMovementDef = existing.entityDefs.get('stock_movement')
    if (!orderDef || !lineItemDef || !stockMovementDef) {
      return { ...state, alreadyUpToDate: true, oldFulfillmentsFieldDropped: false }
    }

    const oldFulfillmentsFieldDropped = await dropStaleJsonFulfillmentsField(
      db,
      organizationId,
      orderDef.id
    )
    if (oldFulfillmentsFieldDropped) {
      // The row `existing.fields` cached for this key is gone; drop it from
      // the in-memory copy too so `ensureCustomFields` below creates the new
      // shape instead of treating the deleted row as still current.
      existing = await loadExistingState(db, organizationId)
    }

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => (NEW_ENTITY_TYPES as readonly string[]).includes(e.entityType)),
      existing,
      state
    )
    entityDefIds.set('order', orderDef.id)
    entityDefIds.set('line_item', lineItemDef.id)
    entityDefIds.set('stock_movement', stockMovementDef.id)

    // 🛑 ONE field map spanning both new defs AND the three widened existing
    // ones. `linkNewRelationships` resolves an inverse out of this map by
    // `<entityType>:<field id>`, so linking the halves of a pair in separate
    // calls would leave each unable to see the other and skip the pair with
    // nothing louder than a debug line (the 135 lesson, restated by 136 and
    // 149).
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

    const orderFulfillments = ORDER_FIELDS.fulfillments
    const lineItemFulfillmentLines = LINE_ITEM_FIELDS.fulfillmentLines
    const stockMovementFulfillmentLine = STOCK_MOVEMENT_FIELDS.fulfillmentLine
    if (!orderFulfillments || !lineItemFulfillmentLines || !stockMovementFulfillmentLine) {
      throw new Error(
        'registry is missing one of order.fulfillments / line_item.fulfillmentLines / ' +
          'stock_movement.fulfillmentLine (migration 153)'
      )
    }

    const widenedOrder = await ensureCustomFields(
      db,
      organizationId,
      'order',
      orderDef.id,
      { fulfillments: orderFulfillments },
      existing,
      state
    )
    for (const [key, value] of widenedOrder) fieldMap.set(key, value)

    const widenedLineItem = await ensureCustomFields(
      db,
      organizationId,
      'line_item',
      lineItemDef.id,
      { fulfillmentLines: lineItemFulfillmentLines },
      existing,
      state
    )
    for (const [key, value] of widenedLineItem) fieldMap.set(key, value)

    const widenedStockMovement = await ensureCustomFields(
      db,
      organizationId,
      'stock_movement',
      stockMovementDef.id,
      { fulfillmentLine: stockMovementFulfillmentLine },
      existing,
      state
    )
    for (const [key, value] of widenedStockMovement) fieldMap.set(key, value)

    await linkNewRelationships(db, fieldMap, entityDefIds, state)
    await assertInversesLinked(db, fieldMap)

    await linkDisplayFields(db, [...NEW_ENTITY_TYPES], entityDefIds, fieldMap)

    const changed =
      state.entityDefsCreated > 0 ||
      state.fieldsCreated > 0 ||
      state.relationshipsLinked > 0 ||
      oldFulfillmentsFieldDropped

    if (changed) {
      // `order_fulfillments` changing shape means a stale `customFields` cache
      // entry would keep resolving the OLD (JSON) definition, which is worse
      // than a missing one: every write would target a field id that no
      // longer exists.
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 153 applied', {
        organizationId,
        ...state,
        oldFulfillmentsFieldDropped,
      })
    }

    return { ...state, alreadyUpToDate: !changed, oldFulfillmentsFieldDropped }
  },
}

/**
 * Delete the OLD `order_fulfillments` `CustomField` row, if it is still the
 * JSON shape entity migration 125 created. Returns whether a row was dropped.
 *
 * Gated on the stored `type` rather than mere presence, so a re-run after
 * this migration already replaced the field with the RELATIONSHIP shape
 * leaves it alone - the whole point of the gate is to never delete the NEW
 * field this same migration created.
 *
 * `FieldValue.fieldId -> CustomField.id` is ON DELETE CASCADE, so every value
 * under the old field is dropped with it. No `FieldValue` delete is issued
 * here - the brief is explicit that this migration must not write one.
 */
async function dropStaleJsonFulfillmentsField(
  db: Database,
  organizationId: string,
  orderDefId: string
): Promise<boolean> {
  const [existingField] = await db
    .select({ id: schema.CustomField.id, type: schema.CustomField.type })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, orderDefId),
        eq(schema.CustomField.systemAttribute, ORDER_FULFILLMENTS_ATTRIBUTE)
      )
    )
    .limit(1)

  if (!existingField || existingField.type === FieldType.RELATIONSHIP) return false

  await db.delete(schema.CustomField).where(eq(schema.CustomField.id, existingField.id))
  logger.info('Dropped stale JSON order_fulfillments field', {
    organizationId,
    fieldId: existingField.id,
    previousType: existingField.type,
  })
  return true
}

/**
 * Fail loudly when a relationship half was created but never linked.
 *
 * `linkNewRelationships` skips an unresolvable inverse with a debug line,
 * which on this migration would mean, for example, a `fulfillment_line` that
 * accepts stock-movement writes nobody can read back through
 * `stockMovements`, silently breaking task 50's netting. `fulfillment.shipment`
 * is deliberately NOT checked here - see {@link RELATIONSHIP_PAIRS}.
 */
async function assertInversesLinked(
  db: Database,
  fieldMap: Map<string, { id: string }>
): Promise<void> {
  for (const { owning, inverse } of RELATIONSHIP_PAIRS) {
    const field = fieldMap.get(owning)
    if (!field) {
      throw new Error(`migration 153 could not resolve the field ${owning}`)
    }
    const row = await db.query.CustomField.findFirst({
      where: eq(schema.CustomField.id, field.id),
      columns: { options: true },
    })
    const inverseId = (row?.options as { relationship?: { inverseResourceFieldId?: string } })
      ?.relationship?.inverseResourceFieldId
    if (!inverseId) {
      throw new Error(
        `migration 153 created ${owning} but could not link it to ${inverse} - the inverse half ` +
          'is missing, and an unlinked relationship writes rows the other side cannot see'
      )
    }
  }
}
