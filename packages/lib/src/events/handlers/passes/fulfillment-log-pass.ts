// packages/lib/src/events/handlers/passes/fulfillment-log-pass.ts
//
// Pass 6 of `events/handlers/finalize-integrity-passes.ts`: derive
// `order_fulfillments` for a connector order from the per-line fulfillment facts
// the sales channel supplied.
//
// `plans/money/tasks/49-bulk-fulfillment-posting.md` §2.1, §8.1 item 3, §8.4
// decision 4.
//
// WHY A PASS AND NOT A CONNECTOR RULE
//
// There is no post-ingest rule mechanism (49 §8.1 item 3): derived facts after a
// sync are a fixed list of guarded passes selected off the tier-1 manifest, and
// `orderDemandPass` next door is the precedent this one copies - one resolve,
// one bounded read, never per record. Putting the derivation in the connector
// instead would put Shopify field paths into the shipment log's writer, which is
// exactly what gap-f `G14` forbids and what the three native `line_item` fields
// of entity migration 137 exist to avoid.
//
// WHAT IT UNBLOCKS
//
// Two things, and the second is the one that is easy to miss:
//
//  1. Revenue. 530 of the dev org's 545 orders arrived already `fulfilled`, and
//     the only door into the ledger is hidden once the status reads that (49
//     §1.2). Nothing native said they had shipped, so nothing could post them.
//  2. Channel credit memos. `orderHadFulfillmentBefore` reads
//     `order_fulfillments`; for a connector order that cell is empty, so every
//     channel refund would skip its revenue leg (49 §8.3). Deriving the log is
//     what lets a channel memo reverse revenue at all.
//
// Keep top-level imports to types and the logger, and lazy-import the rest -
// the same rule `finalize-integrity-passes.ts` states in its own header, for the
// same reason (the events to money/cache boundaries break `vi.mock` otherwise).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { SyncChangeManifest } from '../../../record-rules/sync-manifest-types'

const logger = createScopedLogger('finalize-integrity')

/** Actor for the pass's writes - the same fallback every other pass uses. */
const SYSTEM_ACTOR = 'system'

/**
 * The book time zone to cut ship days in when the org has not set one.
 *
 * ⚠️ UTC, and deliberately NOT a refusal. The derivation is not a posting: a log
 * row is a statement about what shipped, and lane B's poster is the thing that
 * refuses when `accounting.bookTimeZone` is unset (49's preview refusal). An org
 * that has not finished accounting setup still wants its shipment log, and a day
 * derived in UTC is corrected by re-deriving once the zone is set - the merge is
 * a no-op on a matching row and a replacement on an unstamped one.
 */
const FALLBACK_TIME_ZONE = 'UTC'

/**
 * The three `line_item` attributes whose write can change what the log says.
 *
 * Entity migration 137. A touched line carrying any of them enters the pass; an
 * ids-only degraded record (`touched[rid] === 1`, keys shed under the byte
 * budget) enters unconditionally, the rule every pass in this module follows.
 */
const LINE_FULFILLMENT_TRIGGER_ATTRS: ReadonlySet<SystemAttribute> = new Set([
  'line_item_fulfilled_at',
  'line_item_fulfilled_qty',
  'line_item_shipment_count',
])

/** Every `order` attribute the derivation reads. */
const ORDER_ATTRIBUTES = ['order_fulfillments', 'order_shipping_total', 'order_line_items'] as const

/** Every `line_item` attribute the derivation reads. */
const LINE_ATTRIBUTES = [
  'line_item_qty',
  'line_item_unit_price',
  'line_item_tax_total',
  'line_item_fulfilled_at',
  'line_item_fulfilled_qty',
  'line_item_shipment_count',
] as const

/**
 * The slice of the manifest resolver this pass needs.
 *
 * Structurally narrower than `finalize-integrity-passes.ts`'s own
 * `DefFieldResolver` so the two modules do not import each other's types in a
 * cycle; the real resolver is assignable to it.
 */
export type DefEntityTypeResolver = (
  rawDefId: string
) => Promise<{ entityType: string | null } | null>

/** One `FieldValue` row, the columns this pass reads. */
interface ValueRow {
  entityId: string
  fieldId: string
  valueNumber: number | null
  valueDate: string | Date | null
  valueJson: unknown
  relatedEntityId: string | null
}

/**
 * Derive and store the shipment log for every connector order this sync touched.
 *
 * ## Selection
 *
 *  - a touched `line_item` carrying any of {@link LINE_FULFILLMENT_TRIGGER_ATTRS},
 *    or degraded to ids-only, mapped to its order in ONE query through
 *    `resolveParentsByRelation('line_item_order', ...)`,
 *  - plus every touched `order`. An order header write is enough on its own:
 *    `order_shipping_total` is an input to the first shipment's total, and a
 *    connector sync that re-asserts an order whose lines did not move is exactly
 *    the run that should notice the channel has since shipped it,
 *  - minus every order that is NOT connector-managed. A native order's log is
 *    written by `money.fulfillOrder` and a person's clicks, and two writers on
 *    one append-only log is the defect 49 §2.1 exists to end.
 *
 * ## Guarantees
 *
 * **Never throws**, per record and as a whole - one malformed order must not
 * cost the other 500 their log, and this pass runs beside four others that have
 * nothing to do with it.
 *
 * **Writes only when the derivation changed something.** `deriveFulfillmentLog`
 * is append-only and returns `changed: false` for a log it produced itself, so a
 * re-sync of an unchanged order writes nothing at all.
 *
 * @returns the `order` instance ids whose stored log this pass rewrote. Pass 7
 * reads the SIZE of it to decide whether to enqueue the automatic posting run.
 */
export async function fulfillmentLogPass(
  db: Database,
  organizationId: string,
  manifest: SyncChangeManifest,
  resolveDef: DefEntityTypeResolver
): Promise<Set<string>> {
  const changed = new Set<string>()
  try {
    const lineInstanceIds = new Set<string>()
    const orderInstanceIds = new Set<string>()

    for (const [rid, touched] of Object.entries(manifest.touched)) {
      const { entityDefinitionId: rawDefId, entityInstanceId } = parseRecordId(rid as RecordId)
      const def = await resolveDef(rawDefId)
      if (!def) continue
      // Ids-only degradation: the keys were shed under the byte budget, so any
      // fulfillment fact may have moved and the record enters its def's arm.
      const idsOnly = touched === 1
      switch (def.entityType) {
        case 'line_item':
          if (
            idsOnly ||
            (touched as string[]).some((key) =>
              LINE_FULFILLMENT_TRIGGER_ATTRS.has(key as SystemAttribute)
            )
          ) {
            lineInstanceIds.add(entityInstanceId)
          }
          break
        case 'order':
          orderInstanceIds.add(entityInstanceId)
          break
      }
    }

    if (lineInstanceIds.size > 0) {
      const { resolveParentsByRelation } = await import('../../../reconcilers/parent-reconciler')
      const parents = await resolveParentsByRelation(organizationId, 'line_item_order', [
        ...lineInstanceIds,
      ])
      for (const orderId of parents) orderInstanceIds.add(orderId)
    }
    if (orderInstanceIds.size === 0) return changed

    const { listConnectorManagedRecordIds } = await import(
      '../../../data-connectors/managed-fields'
    )
    const managed = await listConnectorManagedRecordIds(db, organizationId, [...orderInstanceIds])
    if (managed.size === 0) return changed

    const context = await loadFieldContext(organizationId)
    if (!context) {
      logger.warn('integrity fulfillment-log pass: the order fields are not provisioned', {
        organizationId,
      })
      return changed
    }

    const timeZone = await readBookTimeZone(organizationId)
    const now = new Date().toISOString()
    const orderIds = [...managed]

    // ── Two bounded reads for the whole batch, never one per order ──
    const orderValues = await selectValues(db, organizationId, orderIds, context.orderFieldIds)
    const lineIdsByOrder = new Map<string, string[]>()
    const allLineIds = new Set<string>()
    for (const orderId of orderIds) {
      const ids = (orderValues.get(orderId)?.get(context.order.order_line_items ?? '') ?? [])
        .map((row) => row.relatedEntityId)
        .filter((id): id is string => !!id)
      lineIdsByOrder.set(orderId, ids)
      for (const id of ids) allLineIds.add(id)
    }
    const lineValues = await selectValues(db, organizationId, [...allLineIds], context.lineFieldIds)

    const { deriveFulfillmentLog } = await import('../../../money/fulfillment-posting/derive-log')
    const { parseFulfillments } = await import('../../../money/orders/reads')
    const { UnifiedCrudHandler } = await import('../../../resources/crud')
    const { toRecordId } = await import('../../../resources/resource-id')

    let heldOut = 0
    for (const orderId of orderIds) {
      try {
        const bucket = orderValues.get(orderId)
        const fulfillmentsFieldId = context.order.order_fulfillments
        const stored = parseFulfillments(
          fulfillmentsFieldId ? bucket?.get(fulfillmentsFieldId)?.[0]?.valueJson : undefined
        )
        const shippingFieldId = context.order.order_shipping_total
        const orderShippingTotalMinor = shippingFieldId
          ? (bucket?.get(shippingFieldId)?.[0]?.valueNumber ?? 0)
          : 0

        const lines = (lineIdsByOrder.get(orderId) ?? []).map((lineId) =>
          toLineFact(lineId, lineValues.get(lineId), context.line)
        )

        const result = deriveFulfillmentLog({
          existing: stored,
          lines,
          orderShippingTotalMinor,
          timeZone,
          now,
        })
        if (result.heldOut) heldOut++
        if (!result.changed) continue

        // 🛑 The `{ fulfillments }` OBJECT, never the bare array. A `FieldValue`
        // write reads a top-level array as a MULTI-VALUE write against a
        // single-value field, and `setFieldValues` LOGS and SWALLOWS the
        // refusal - the update reports success over an order whose log is
        // silently empty (`money/orders/client.ts` says so at length). The
        // field-value layer adds its own `{ v }` envelope on top; only the inner
        // wrapper is ours.
        const handler = new UnifiedCrudHandler(organizationId, SYSTEM_ACTOR, db)
        await handler.update(toRecordId(context.orderDefId, orderId), {
          order_fulfillments: { fulfillments: result.fulfillments },
        })
        changed.add(orderId)
      } catch (error) {
        logger.error('integrity fulfillment-log pass: order failed', {
          organizationId,
          orderId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    logger.info('integrity fulfillment-log pass done', {
      organizationId,
      orders: orderIds.length,
      changed: changed.size,
      heldOut,
    })
  } catch (error) {
    logger.error('integrity fulfillment-log pass failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return changed
}

/** The resolved def and field ids the two bounded reads need. */
interface FulfillmentLogFieldContext {
  orderDefId: string
  order: Partial<Record<(typeof ORDER_ATTRIBUTES)[number], string>>
  line: Partial<Record<(typeof LINE_ATTRIBUTES)[number], string>>
  orderFieldIds: string[]
  lineFieldIds: string[]
}

/**
 * Resolve the `order` def and every field id, through the org cache.
 *
 * Null when the org has no `order` def or has not run entity migration 125 -
 * without `order_fulfillments` there is nowhere to write, and the honest
 * response is to skip the org rather than to write a log into a field that does
 * not exist (which `setFieldValues` would swallow).
 */
async function loadFieldContext(
  organizationId: string
): Promise<FulfillmentLogFieldContext | null> {
  const { getCachedEntityDefId, getOrgCache } = await import('../../../cache')
  const orderDefId = await getCachedEntityDefId(organizationId, 'order')
  if (!orderDefId) return null

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...ORDER_ATTRIBUTES, ...LINE_ATTRIBUTES])
  const resolved = fields as unknown as Record<string, { id: string } | null>

  const order: FulfillmentLogFieldContext['order'] = {}
  for (const attribute of ORDER_ATTRIBUTES) {
    const id = resolved[attribute]?.id
    if (id) order[attribute] = id
  }
  const line: FulfillmentLogFieldContext['line'] = {}
  for (const attribute of LINE_ATTRIBUTES) {
    const id = resolved[attribute]?.id
    if (id) line[attribute] = id
  }
  if (!order.order_fulfillments || !order.order_line_items) return null

  return {
    orderDefId,
    order,
    line,
    orderFieldIds: Object.values(order),
    lineFieldIds: Object.values(line),
  }
}

/** `accounting.bookTimeZone`, or UTC. See {@link FALLBACK_TIME_ZONE}. */
async function readBookTimeZone(organizationId: string): Promise<string> {
  try {
    const { getOrganizationSetting } = await import('../../../settings/settings-service')
    const value = await getOrganizationSetting({
      organizationId,
      key: 'accounting.bookTimeZone',
    })
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : FALLBACK_TIME_ZONE
  } catch {
    return FALLBACK_TIME_ZONE
  }
}

/** One line's facts, from its pivoted `FieldValue` rows. */
function toLineFact(
  lineId: string,
  bucket: Map<string, ValueRow[]> | undefined,
  fields: FulfillmentLogFieldContext['line']
) {
  const cell = (attribute: keyof FulfillmentLogFieldContext['line']): ValueRow | undefined => {
    const fieldId = fields[attribute]
    return fieldId ? bucket?.get(fieldId)?.[0] : undefined
  }
  return {
    lineId,
    orderedQuantity: cell('line_item_qty')?.valueNumber ?? 0,
    unitPriceMinor: cell('line_item_unit_price')?.valueNumber ?? 0,
    // Null, never zero: the channel supplying no per-line tax is a different
    // state from it supplying a zero (48 §8.2), and the batch builder allocates
    // the order's tax when any line is null.
    lineTaxMinor: cell('line_item_tax_total')?.valueNumber ?? null,
    fulfilledAt: toInstant(cell('line_item_fulfilled_at')?.valueDate),
    fulfilledQuantity: cell('line_item_fulfilled_qty')?.valueNumber ?? null,
    shipmentCount: cell('line_item_shipment_count')?.valueNumber ?? null,
  }
}

/**
 * A `valueDate` as an ISO instant, or null.
 *
 * `FieldValue.valueDate` is declared `mode: 'string'` while the driver hands
 * back a parsed `Date` for a `timestamptz` expression, so both shapes arrive
 * here (`builds/backfill-queries.ts` documents the same seam). An unparseable
 * value becomes null rather than an Invalid Date, which would compare false
 * against everything and vanish from the arithmetic much later.
 */
function toInstant(value: string | Date | null | undefined): string | null {
  if (value == null) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * `FieldValue` rows for a set of instances and fields, bucketed
 * `instance -> field -> rows`.
 *
 * The inner value is an ARRAY because a relationship field has one row per
 * related record, and `order_line_items` is exactly that. The same shape
 * `money/orders/reads.ts` uses, and the reason it reads columns rather than
 * going through a typed handler: `order_fulfillments` carries the field-value
 * layer's `{ v, meta }` envelope and `parseFulfillments` has to see it.
 */
async function selectValues(
  db: Database,
  organizationId: string,
  entityIds: readonly string[],
  fieldIds: readonly string[]
): Promise<Map<string, Map<string, ValueRow[]>>> {
  const buckets = new Map<string, Map<string, ValueRow[]>>()
  if (entityIds.length === 0 || fieldIds.length === 0) return buckets

  const { schema } = await import('@auxx/database')
  const { and, eq, inArray } = await import('drizzle-orm')

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueNumber: schema.FieldValue.valueNumber,
      valueDate: schema.FieldValue.valueDate,
      valueJson: schema.FieldValue.valueJson,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, [...entityIds]),
        inArray(schema.FieldValue.fieldId, [...fieldIds])
      )
    )

  for (const row of rows) {
    let byField = buckets.get(row.entityId)
    if (!byField) {
      byField = new Map()
      buckets.set(row.entityId, byField)
    }
    const list = byField.get(row.fieldId)
    if (list) list.push(row as ValueRow)
    else byField.set(row.fieldId, [row as ValueRow])
  }
  return buckets
}
