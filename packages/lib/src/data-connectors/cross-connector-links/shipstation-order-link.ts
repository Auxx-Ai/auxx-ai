// packages/lib/src/data-connectors/cross-connector-links/shipstation-order-link.ts
// Link a ShipStation shipment to the Shopify order it was created from
// (plans/apps/shipstation/shipstation-status-and-linking-plan.md §4).
//
// WHY THIS IS NOT A CONNECTOR MAPPING (§4.4, verified in `service.ts`):
// `linkMode: 'reference'` cannot cross connectors. `findItemByDef` filters
// `dataConnectorId` with hard equality, so a ShipStation reference to a
// Shopify-created order resolves nothing, lands back on `stillPending`, and is
// retried every run forever. `shipment_order` is therefore declared on the def and
// bound by nothing. This pass fills it from the OTHER side of the fence:
// `RecordIdentity`, the org-wide, connector-agnostic identity index.
//
// THE JOIN, AND WHY IT IS SAFE TO INFER:
// `external_shipment_id` is populated 135/135 on the reference account and shaped
// `<shopifyOrderId>-<unknown>`, e.g. `7475907559600-8667090518192`. Only the FIRST
// component is verified; the suffix matches 0 of 135 Shopify order ids and its
// semantics are unknown, so this pass never parses it.
//
// The format is INFERRED from one merchant, one order source, one carrier. It is not
// provider-stated: `order_source_code` is null on every shipment and every shipment
// item, so we cannot ask the API which channel a shipment came from, and the shape is
// not even uniform inside one merchant (9 of 135 values are UUIDs from a different
// order source). Every rule below exists so a WRONG FORMAT GUESS PRODUCES ZERO LINKS,
// NEVER WRONG LINKS:
//
//   - attempt only on `^[0-9]{8,}-[0-9]+$`; a UUID, a bare id, or anything else is
//     skipped without a lookup
//   - link only on EXACT string equality to a stored Shopify order id
//   - no match means no link, SILENTLY: not an error, not a warning, and above all
//     not a pending edge that retries forever. A merchant on a different shape gets
//     nulls, which is the status quo
//   - an id resolving to two records across two Shopify connections is AMBIGUOUS and
//     links nothing
//   - never a fuzzy match, a nearest match, or a match on order NUMBER. Order numbers
//     are merchant-customizable (prefixes, suffixes, custom sequences); order ids are
//     opaque global integers with no merchant control. That distinction is the entire
//     reason this is safe
//   - never a match on TRACKING NUMBER, anywhere (see the connector's own comments)
//
// NOT-YET-SYNCED IS THE NORMAL CASE, NOT AN ERROR. A sync can park partway (the 9,000
// record ingest ceiling), and ShipStation ships faster than the Shopify delta lands:
// on the reference account 8 of the 125 qualifying shipments name an order id larger
// than the largest order synced. Those simply do not link this run. The pass holds NO
// retry state of any kind — it re-derives everything from `external_shipment_id`,
// which is stored raw — so a later run picks them up for free and nothing accumulates.
//
// IDEMPOTENCY, the same fix `relationship-pass.ts` needed: the pass re-examines every
// shipment on every run, so without a guard it would DELETE+INSERT an identical
// `FieldValue` row and fire the whole `entity:field:updated` fan-out (timeline entry,
// activity touch, record rules) for each, every 15 minutes. The fix suppresses the
// WRITE, not the event: one bulk pre-read of the current targets, and an edge already
// pointing at the right order is left alone. A genuine link still fires everything it
// fires today.

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { toRecordId } from '../../resources/resource-id'
import type { SyncCtx } from '../sinks/types'
import {
  findShopifyOrderInstances,
  listShipmentBindings,
  readCurrentOrderTargets,
  readExternalShipmentIds,
  resolveShipmentOrderLinkFields,
  SHIPMENT_ORDER_ATTRIBUTE,
} from './queries'

const logger = createScopedLogger('data-connector-shipstation-order-link')

/**
 * `DataConnector.type` of a ShipStation connector. The dispatch gates on this, so
 * no other connector ever runs this pass.
 */
export const SHIPSTATION_CONNECTOR_TYPE = 'app:shipstation'

/**
 * The ONLY accepted shape. Anchored at both ends, so a UUID
 * (`029dca61-7961-cd09-...`), a bare id (`7439103557808`) and a three-part value all
 * fail it. The `{8,}` floor rejects a short numeric prefix that could collide with an
 * unrelated integer; real Shopify order ids are 13 digits today.
 */
const EXTERNAL_SHIPMENT_ID_PATTERN = /^([0-9]{8,})-[0-9]+$/

/** What one pass did. Every counter is a shipment, and they sum to `examined`. */
export interface ShipStationOrderLinkSummary {
  /** Live shipment bindings of this connector that the pass looked at. */
  examined: number
  /** No `external_shipment_id` stored at all. */
  missingExternalId: number
  /** Stored, but not numeric-pair shaped (UUIDs, bare ids): skipped without a lookup. */
  skippedShape: number
  /**
   * Parsed to a plausible order id that this org does not store, or that is ambiguous
   * across two Shopify connections. Left null, silently — usually an order the Shopify
   * connector has not synced yet, which resolves on a later run at no cost.
   */
  unmatched: number
  /** Edges written this pass. */
  linked: number
  /** Edges already pointing at the right order: no write, no event, no `touchedDefs`. */
  alreadyLinked: number
  /** The user PAUSED `shipment_order` on this record (plan 40), so it is left alone. */
  pinned: number
  /** The relationship write threw. No state is kept; the next run simply retries. */
  failed: number
}

const EMPTY: ShipStationOrderLinkSummary = {
  examined: 0,
  missingExternalId: 0,
  skippedShape: 0,
  unmatched: 0,
  linked: 0,
  alreadyLinked: 0,
  pinned: 0,
  failed: 0,
}

/**
 * Extract the Shopify order id from a raw `external_shipment_id`.
 *
 * Pure, and the single place the format guess lives. Returns `null` for anything that
 * is not exactly `<8+ digits>-<digits>` — which is what turns "we guessed the shape
 * wrong" into "we linked nothing" instead of "we linked wrongly". The second component
 * is matched only so the shape can be asserted; its value is never read.
 */
export function parseShopifyOrderIdFromExternalShipmentId(
  raw: string | null | undefined
): string | null {
  if (!raw) return null
  return EXTERNAL_SHIPMENT_ID_PATTERN.exec(raw)?.[1] ?? null
}

/**
 * Resolve `shipment_order` for every live shipment of a ShipStation connector.
 *
 * Runs at the connector finalize, at a park, and after a webhook-steered fetch. Safe
 * on a partial run for the same reasons the relationship pass is: it is additive,
 * self-deferring and connector-wide.
 *
 * Never throws — an order link is a nicety, and a failure here must not turn a clean
 * sync into a failed one. Callers log the `err` and carry on.
 */
export async function resolveShipStationOrderLinks(
  ctx: SyncCtx
): Promise<Result<ShipStationOrderLinkSummary, Error>> {
  try {
    return ok(await runPass(ctx))
  } catch (error) {
    logger.warn('shipstation order link pass failed — links left untouched', {
      connectorId: ctx.connector.id,
      runId: ctx.runId,
      error: error instanceof Error ? error.message : String(error),
    })
    return err(error instanceof AuxxError ? error : new AuxxError('ShipStation order link failed'))
  }
}

async function runPass(ctx: SyncCtx): Promise<ShipStationOrderLinkSummary> {
  const fields = await resolveShipmentOrderLinkFields(ctx.orgId)
  if (!fields) return EMPTY

  const bindings = await listShipmentBindings(ctx.db, ctx.connector.id, fields.shipmentDefId)
  if (bindings.length === 0) return EMPTY

  const summary: ShipStationOrderLinkSummary = { ...EMPTY, examined: bindings.length }

  // One record can carry two bindings (two mappings onto one instance), so pins union.
  const pinnedByInstance = new Map<string, Set<string>>()
  for (const binding of bindings) {
    let pins = pinnedByInstance.get(binding.entityInstanceId)
    if (!pins) {
      pins = new Set<string>()
      pinnedByInstance.set(binding.entityInstanceId, pins)
    }
    for (const fieldId of binding.pinnedFields) pins.add(fieldId)
  }
  const instanceIds = [...pinnedByInstance.keys()]

  const rawById = await readExternalShipmentIds(
    ctx.db,
    ctx.orgId,
    fields.externalShipmentIdFieldId,
    instanceIds
  )

  // PARSE + SHAPE GATE. Everything that does not qualify is counted and dropped here,
  // before any lookup, so a merchant on a different shape costs one regex per row.
  const candidates = new Map<string, string>()
  for (const instanceId of instanceIds) {
    const raw = rawById.get(instanceId)
    if (!raw) {
      summary.missingExternalId += 1
      continue
    }
    const orderExternalId = parseShopifyOrderIdFromExternalShipmentId(raw)
    if (!orderExternalId) {
      summary.skippedShape += 1
      continue
    }
    candidates.set(instanceId, orderExternalId)
  }
  if (candidates.size === 0) return summary

  const orderInstances = await findShopifyOrderInstances(ctx.db, ctx.orgId, fields.orderDefId, [
    ...new Set(candidates.values()),
  ])

  // EXACT EQUALITY ONLY. `undefined` (no such order yet) and `null` (ambiguous across
  // two Shopify connections) are both "no link", and both are silent.
  const resolved = new Map<string, string>()
  for (const [instanceId, orderExternalId] of candidates) {
    const orderInstanceId = orderInstances.get(orderExternalId)
    if (!orderInstanceId) {
      summary.unmatched += 1
      continue
    }
    resolved.set(instanceId, orderInstanceId)
  }
  if (resolved.size === 0) return summary

  const currentTargets = await readCurrentOrderTargets(ctx.db, ctx.orgId, fields.orderFieldId, [
    ...resolved.keys(),
  ])

  let firstWriteError: string | undefined
  for (const [instanceId, orderInstanceId] of resolved) {
    // PAUSED on this record (plan 40 D4): the user re-pointed the order by hand, so
    // the connector may not touch it. Not a warning — it is the user's choice.
    if (pinnedByInstance.get(instanceId)?.has(fields.orderFieldId)) {
      summary.pinned += 1
      continue
    }

    // IDEMPOTENCY GUARD. Deliberately does NOT `touchedDefs.add(...)`: nothing changed
    // on this def from this pass, so it must not force a `records:invalidated` refetch.
    if (currentTargets.get(`${instanceId}::${fields.orderFieldId}`) === orderInstanceId) {
      summary.alreadyLinked += 1
      continue
    }

    try {
      // Through `relationshipCrud`, not `crud`: `crud` runs under the run's silent
      // `sync` session, and a genuine new link must keep firing `entity:field:updated`,
      // the activity touch and record rules.
      await ctx.relationshipCrud.update(
        toRecordId(fields.shipmentDefId, instanceId),
        { [SHIPMENT_ORDER_ATTRIBUTE]: toRecordId(fields.orderDefId, orderInstanceId) },
        undefined,
        {}
      )
      ctx.touchedDefs.add(fields.shipmentDefId)
      summary.linked += 1
    } catch (error) {
      summary.failed += 1
      firstWriteError ??= error instanceof Error ? error.message : String(error)
    }
  }

  if (summary.failed > 0) {
    logger.warn('shipstation order links failed to write — retried on the next run', {
      connectorId: ctx.connector.id,
      runId: ctx.runId,
      failed: summary.failed,
      error: firstWriteError,
    })
  }

  logger.info('shipstation order link pass done', {
    connectorId: ctx.connector.id,
    runId: ctx.runId,
    ...summary,
  })
  return summary
}
