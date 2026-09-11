// packages/lib/src/data-connectors/cross-connector-links/index.ts
// The engine's single door to cross-connector record linking.
//
// A connector's own two-pass (`relationship-pass.ts`) resolves edges by
// `(dataConnectorId, def, externalId)` and so can only ever see records THIS
// connector created. The few links that must cross that fence resolve through
// `RecordIdentity` instead, and they live here.
//
// The dispatch is deliberately a `switch` on `connector.type` rather than a
// registry: there is exactly one such link today (ShipStation shipment -> Shopify
// order), and its rules are specific enough — a provider-specific id format,
// inferred from one merchant — that generalising them would mean inventing
// configuration nobody has asked for. What the seam DOES buy is that the engine's
// finalize path never names an app.

import { ok, type Result } from 'neverthrow'
import type { SyncCtx } from '../sinks/types'
import {
  resolveShipStationOrderLinks,
  SHIPSTATION_CONNECTOR_TYPE,
  type ShipStationOrderLinkSummary,
} from './shipstation-order-link'

/** What a cross-connector link pass did, or all-zeroes when none applied. */
export type CrossConnectorLinkSummary = ShipStationOrderLinkSummary

const NONE: CrossConnectorLinkSummary = {
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
 * Run whichever cross-connector link pass this connector has, if any.
 *
 * Called alongside `resolveRelationships` at the connector finalize, at a park, and
 * after a webhook-steered fetch — all three for the same reason: the pass is
 * additive, self-deferring and connector-wide, so it is safe on a partial run and a
 * target that is not synced yet simply resolves on a later run.
 *
 * Holds no retry state, so calling it more often is free. Never throws; the `err`
 * arm is for the caller to log, never to fail the run on.
 */
export async function resolveCrossConnectorLinks(
  ctx: SyncCtx
): Promise<Result<CrossConnectorLinkSummary, Error>> {
  switch (ctx.connector.type) {
    case SHIPSTATION_CONNECTOR_TYPE:
      return resolveShipStationOrderLinks(ctx)
    default:
      return ok(NONE)
  }
}

export {
  parseShopifyOrderIdFromExternalShipmentId,
  resolveShipStationOrderLinks,
  SHIPSTATION_CONNECTOR_TYPE,
  type ShipStationOrderLinkSummary,
} from './shipstation-order-link'
