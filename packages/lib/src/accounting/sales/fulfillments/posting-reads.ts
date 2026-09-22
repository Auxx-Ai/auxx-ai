// packages/lib/src/accounting/sales/fulfillments/posting-reads.ts

/**
 * What the shipment poster and its sweep ASK, as opposed to what they write:
 * the shipments nobody has tried, and the shipment drawer's read.
 *
 * Reads only; the poster lives in `accounting.ts` and the sweep's loop in
 * `accounting-sweep.ts` (`docs/lib-module-guide.md` §5). No permission checks
 * anywhere in this file (§6).
 */

import type { Database } from '@auxx/database'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { sql } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../../cache'
import { systemFieldMap } from '../../../resources/system-records'
import { listWorkItemsForSource, type WorkItemRow } from '../../work-items/reads'
import { noWorkItem } from '../../work-items/sweep'

/** The window the sweep's candidate query cuts on, read once per pass. */
export interface FulfillmentCandidateWindow {
  /** `accounting.cutoffPeriod` (`YYYY-MM`). Shipments on or before it are refused forever. */
  cutoffPeriod: string | null
  /** `accounting.bookTimeZone`, the zone a shipment's book month is cut in. */
  bookTimeZone: string
}

const CANDIDATE_ATTRS = [
  'fulfillment_status',
  'fulfillment_shipped_at',
  'fulfillment_subtotal',
  'fulfillment_total',
] as const

/**
 * Live, stamped, non-zero shipments after the cutoff that hold no claim
 * and no work item - the ones nobody has tried. A refused one comes back through its
 * work item's `nextAttemptAt` instead.
 *
 * `fulfillment_subtotal` present is the "78's stamp has run" test and
 * `fulfillment_total <> 0` the "worth something" one (§7.3). Empty, never a
 * refusal, on an org with no `fulfillment` def.
 */
export async function listFulfillmentAccountingCandidates(
  db: Database,
  organizationId: string,
  limit = 100,
  window?: FulfillmentCandidateWindow
): Promise<string[]> {
  const defId = await getCachedEntityDefId(organizationId, 'fulfillment')
  if (!defId) return []
  const fields = await systemFieldMap<SystemAttribute>(db, organizationId, [...CANDIDATE_ATTRS])
  const shippedAt = fields.fulfillment_shipped_at?.id
  const subtotal = fields.fulfillment_subtotal?.id
  const total = fields.fulfillment_total?.id
  const status = fields.fulfillment_status?.id
  if (!shippedAt || !subtotal || !total || !status) return []

  const zone = window?.bookTimeZone ?? 'UTC'
  const result = await db.execute(sql`
    SELECT ship."entityId" AS id
    FROM "FieldValue" ship
    JOIN "FieldValue" tot ON tot."organizationId" = ship."organizationId"
      AND tot."entityId" = ship."entityId" AND tot."fieldId" = ${total}
    WHERE ship."organizationId" = ${organizationId}
      AND ship."entityDefinitionId" = ${defId}
      AND ship."fieldId" = ${shippedAt}
      AND ship."valueDate" IS NOT NULL
      AND tot."valueNumber" IS NOT NULL AND tot."valueNumber" <> 0
      AND EXISTS (SELECT 1 FROM "FieldValue" sub
        WHERE sub."organizationId" = ${organizationId}
          AND sub."entityId" = ship."entityId" AND sub."fieldId" = ${subtotal}
          AND sub."valueNumber" IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM "FieldValue" st
        WHERE st."organizationId" = ${organizationId}
          AND st."entityId" = ship."entityId" AND st."fieldId" = ${status}
          AND st."optionId" = 'cancelled')
      ${
        window?.cutoffPeriod
          ? sql`AND to_char((ship."valueDate" AT TIME ZONE ${zone}), 'YYYY-MM') > ${window.cutoffPeriod}`
          : sql``
      }
      AND ${noWorkItem(organizationId, { stage: 'post', sourceKind: 'fulfillment', sourceId: sql`ship."entityId"` })}
      AND NOT EXISTS (SELECT 1 FROM "GlPostingSource" link
        WHERE link."organizationId" = ${organizationId}
          AND link."sourceKind" = 'fulfillment'
          AND link."sourceId" = ship."entityId"
          AND link."linkRole" = 'subject')
    ORDER BY ship."valueDate" ASC, ship."entityId" ASC
    LIMIT ${limit}
  `)
  return (result.rows as Array<{ id: string }>).map((row) => row.id)
}

/** One shipment for the `?shipment=` drawer, parked or posted (88 §4.5). */
export interface ShipmentDetail {
  /** The `fulfillment` instance id. */
  id: string
  entityDefinitionId: string
  /** `fulfillment_name`, the record's display name. */
  name: string | null
  orderId: string | null
  orderDefinitionId: string | null
  orderName: string | null
  /** The instant the goods went out, or `null` for a shipment with no date. */
  shippedAt: string | null
  /** `fulfillment_total`, integer minor units in the order's currency. */
  amountMinor: number
  currency: string
  /** Its parked work; empty once nothing is waiting. */
  workItems: WorkItemRow[]
}

const DETAIL_ATTRS = [
  'fulfillment_shipped_at',
  'fulfillment_total',
  'fulfillment_order',
  'order_currency',
] as const

/** One shipment with its order and its work items, or `null` when it does not exist. */
export async function readShipmentDetail(
  db: Database,
  organizationId: string,
  fulfillmentId: string
): Promise<ShipmentDetail | null> {
  const defId = await getCachedEntityDefId(organizationId, 'fulfillment')
  if (!defId) return null
  const fields = await systemFieldMap<SystemAttribute>(db, organizationId, [...DETAIL_ATTRS])
  const shippedAt = fields.fulfillment_shipped_at?.id ?? ''
  const total = fields.fulfillment_total?.id ?? ''
  const orderRel = fields.fulfillment_order?.id ?? ''
  const currency = fields.order_currency?.id ?? ''

  const result = await db.execute(sql`
    SELECT f."id", f."entityDefinitionId", f."displayName" AS "name",
      ship."valueDate" AS "shippedAt", tot."valueNumber" AS "total",
      ord."id" AS "orderId", ord."entityDefinitionId" AS "orderDefinitionId",
      ord."displayName" AS "orderName", cur."valueText" AS "currency"
    FROM "EntityInstance" f
    LEFT JOIN "FieldValue" ship ON ship."organizationId" = f."organizationId"
      AND ship."entityId" = f."id" AND ship."fieldId" = ${shippedAt}
    LEFT JOIN "FieldValue" tot ON tot."organizationId" = f."organizationId"
      AND tot."entityId" = f."id" AND tot."fieldId" = ${total}
    LEFT JOIN "FieldValue" rel ON rel."organizationId" = f."organizationId"
      AND rel."entityId" = f."id" AND rel."fieldId" = ${orderRel}
    LEFT JOIN "EntityInstance" ord ON ord."id" = rel."relatedEntityId"
      AND ord."organizationId" = f."organizationId"
    LEFT JOIN "FieldValue" cur ON cur."organizationId" = f."organizationId"
      AND cur."entityId" = ord."id" AND cur."fieldId" = ${currency}
    WHERE f."organizationId" = ${organizationId}
      AND f."entityDefinitionId" = ${defId}
      AND f."id" = ${fulfillmentId}
    LIMIT 1
  `)
  const row = result.rows[0] as
    | {
        id: string
        entityDefinitionId: string
        name: string | null
        shippedAt: string | null
        total: number | string | null
        orderId: string | null
        orderDefinitionId: string | null
        orderName: string | null
        currency: string | null
      }
    | undefined
  if (!row) return null
  const workItems = await listWorkItemsForSource(db, organizationId, {
    sourceKind: 'fulfillment',
    sourceId: fulfillmentId,
  })
  return {
    id: row.id,
    entityDefinitionId: row.entityDefinitionId,
    name: row.name,
    orderId: row.orderId,
    orderDefinitionId: row.orderDefinitionId,
    orderName: row.orderName,
    shippedAt: row.shippedAt ? new Date(row.shippedAt).toISOString() : null,
    amountMinor: Number(row.total ?? 0),
    currency: row.currency ?? 'USD',
    workItems: workItems.isOk() ? workItems.value : [],
  }
}
