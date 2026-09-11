// packages/lib/src/data-connectors/cross-connector-links/queries.ts
// Every read the ShipStation -> Shopify order link pass makes, in one file so the
// decision logic in `shipstation-order-link.ts` stays pure enough to unit-test
// without a database (Drizzle column refs are undefined under vitest).
//
// All four reads are BULK and bounded: the pass never issues a query per shipment.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getCachedCustomFields, getCachedEntityDefId } from '../../cache'
import { readRelationshipTargets } from '../service'

/** `entityType` of the registry defs this pass bridges. */
const SHIPMENT_ENTITY_TYPE = 'shipment'
const ORDER_ENTITY_TYPE = 'order'

/** The ShipStation app field carrying the raw `external_shipment_id`. */
const EXTERNAL_SHIPMENT_ID_APP_FIELD = 'externalShipmentId'

/** The `systemAttribute` of the relationship this pass populates. */
export const SHIPMENT_ORDER_ATTRIBUTE = 'shipment_order'

/** `RecordIdentity.source` / `.appFieldKey` the Shopify connector writes an order under. */
const SHOPIFY_SOURCE = 'shopify'
const SHOPIFY_ORDER_ID_APP_FIELD = 'shopifyOrderId'

/** Max ids per `IN (...)`, matching `readRelationshipTargets`. */
const CHUNK = 500

/** The four org-scoped ids the pass needs before it can read anything else. */
export interface ShipmentOrderLinkFields {
  shipmentDefId: string
  orderDefId: string
  /** `CustomField.id` of the shipment's `externalShipmentId` app field. */
  externalShipmentIdFieldId: string
  /** `CustomField.id` of `shipment_order`. */
  orderFieldId: string
}

/** One live shipment binding of the connector being synced. */
export interface ShipmentBinding {
  entityInstanceId: string
  /** Concrete `CustomField.id`s the user PAUSED on this record (plan 40). */
  pinnedFields: string[]
}

function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Resolve the shipment/order defs and the two fields from the org cache.
 *
 * Returns `null` when any of them is missing, which is the whole "this org is not
 * shaped for the link" exit: an org without the shipment registry def, without the
 * ShipStation app field, or on a catalog old enough to predate `shipment_order`
 * simply does no work. Never an error — a missing def is not a failure of the sync.
 */
export async function resolveShipmentOrderLinkFields(
  orgId: string
): Promise<ShipmentOrderLinkFields | null> {
  const [shipmentDefId, orderDefId] = await Promise.all([
    getCachedEntityDefId(orgId, SHIPMENT_ENTITY_TYPE),
    getCachedEntityDefId(orgId, ORDER_ENTITY_TYPE),
  ])
  if (!shipmentDefId || !orderDefId) return null

  const shipmentFields = await getCachedCustomFields(orgId, shipmentDefId)
  const externalIdField = shipmentFields.find(
    (f) => f.appFieldKey === EXTERNAL_SHIPMENT_ID_APP_FIELD
  )
  const orderField = shipmentFields.find((f) => f.systemAttribute === SHIPMENT_ORDER_ATTRIBUTE)
  if (!externalIdField || !orderField) return null

  return {
    shipmentDefId,
    orderDefId,
    externalShipmentIdFieldId: externalIdField.id,
    orderFieldId: orderField.id,
  }
}

/**
 * Live, bound shipment records of ONE connector.
 *
 * Scoped to the connector rather than to the def so a second ShipStation
 * connection in the same org resolves only its own shipments, and archived
 * bindings are skipped (their record is gone upstream; re-linking it is noise).
 * Backed by the `(dataConnectorId, entityDefinitionId, externalId)` index prefix.
 */
export async function listShipmentBindings(
  db: Database,
  dataConnectorId: string,
  shipmentDefId: string
): Promise<ShipmentBinding[]> {
  const rows = await db
    .select({
      entityInstanceId: schema.DataConnectorItem.entityInstanceId,
      pinnedFields: schema.DataConnectorItem.pinnedFields,
    })
    .from(schema.DataConnectorItem)
    .where(
      and(
        eq(schema.DataConnectorItem.dataConnectorId, dataConnectorId),
        eq(schema.DataConnectorItem.entityDefinitionId, shipmentDefId),
        isNull(schema.DataConnectorItem.archivedAt)
      )
    )

  const out: ShipmentBinding[] = []
  for (const row of rows) {
    if (!row.entityInstanceId) continue
    out.push({ entityInstanceId: row.entityInstanceId, pinnedFields: row.pinnedFields ?? [] })
  }
  return out
}

/**
 * Raw `external_shipment_id` per shipment instance.
 *
 * Read from `FieldValue` rather than from the connector item because the value is
 * an ordinary app-field cell, not part of the binding. A shipment with no value is
 * simply absent from the map.
 *
 * @returns `entityInstanceId` -> the raw, unparsed provider string
 */
export async function readExternalShipmentIds(
  db: Database,
  organizationId: string,
  fieldId: string,
  entityInstanceIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const ids of chunk(entityInstanceIds)) {
    const rows = await db
      .select({
        entityId: schema.FieldValue.entityId,
        valueText: schema.FieldValue.valueText,
      })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.fieldId, fieldId),
          inArray(schema.FieldValue.entityId, ids)
        )
      )
    for (const row of rows) {
      if (row.valueText && !out.has(row.entityId)) out.set(row.entityId, row.valueText)
    }
  }
  return out
}

/**
 * Reverse-resolve Shopify order ids to the order records this org already stores,
 * through `RecordIdentity` (the write-through index the Shopify connector mirrors
 * every identity cell into) rather than through `DataConnectorItem` — which is what
 * makes this CROSS-connector at all. `findItemByDef` filters `dataConnectorId` with
 * hard equality, so the connector-scoped path can never see a Shopify-created order.
 *
 * `connectionId` is deliberately NOT filtered: the ShipStation side carries no usable
 * channel signal (`order_source_code` is null on every shipment), so the pass cannot
 * know which store an id came from. An id that resolves to two different records
 * across two Shopify connections is mapped to `null` — AMBIGUOUS, treated by the
 * caller exactly like "not found", so a two-store org gets no link rather than a
 * coin-flip link.
 *
 * @returns `externalId` -> order `entityInstanceId`, or `null` when ambiguous
 */
export async function findShopifyOrderInstances(
  db: Database,
  organizationId: string,
  orderDefId: string,
  externalIds: string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  for (const ids of chunk(externalIds)) {
    const rows = await db
      .select({
        externalId: schema.RecordIdentity.externalId,
        entityInstanceId: schema.RecordIdentity.entityInstanceId,
      })
      .from(schema.RecordIdentity)
      .where(
        and(
          eq(schema.RecordIdentity.organizationId, organizationId),
          eq(schema.RecordIdentity.entityDefinitionId, orderDefId),
          eq(schema.RecordIdentity.source, SHOPIFY_SOURCE),
          eq(schema.RecordIdentity.appFieldKey, SHOPIFY_ORDER_ID_APP_FIELD),
          inArray(schema.RecordIdentity.externalId, ids)
        )
      )
    for (const row of rows) {
      const seen = out.get(row.externalId)
      if (seen === undefined) out.set(row.externalId, row.entityInstanceId)
      else if (seen !== row.entityInstanceId) out.set(row.externalId, null)
    }
  }
  return out
}

/**
 * Current `shipment_order` targets, for the idempotency guard. Thin wrapper over
 * the two-pass's own reader so both passes answer "is this edge already right?"
 * from identical rules (exactly one non-null target, or absent).
 *
 * @returns `${entityInstanceId}::${orderFieldId}` -> current target instance id
 */
export async function readCurrentOrderTargets(
  db: Database,
  organizationId: string,
  orderFieldId: string,
  entityInstanceIds: string[]
): Promise<Map<string, string>> {
  return readRelationshipTargets(
    db,
    organizationId,
    entityInstanceIds.map((entityInstanceId) => ({ entityInstanceId, fieldId: orderFieldId }))
  )
}
