// packages/lib/src/data-connectors/inventory-bridge-pass.ts
// The v9 inventory→part watermark pass (Option W). Runs at the end of every connector
// sync run (full, incremental, steered partial, sweep) for connectors whose org has
// INVENTORY_BRIDGE config matching one of the connector's target defs. For each linked
// inventory-source record it compares the freshly-synced quantity to a stored watermark
// and, on a decrease, emits ONE `sale` stock movement (with BOM explosion) — reusing the
// existing deduction engine unchanged. The watermark advance is a compare-and-swap, so a
// steered run finishing while the sweep runs emits exactly one movement.
//
// The sink writes with `skipEvents: true`, so field-change hooks never fire on sync writes
// (that's why this is a post-sink pass, not a hook). See the plan's "Verified findings".
//
// Modes:
//  - `auto`    → create the movement immediately + advance the watermark.
//  - `confirm` → (default, safe) do NOT deduct or advance; the pending delta (watermark vs
//    current cell) is re-derivable each pass and surfaced/applied on the part console.
//    Deferred until the user applies it (there is no global review feed yet).
//
// See plans/data-connectors/v9/shopify-inventory-part-bridge-plan.md (Piece C).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedEntityDefId } from '../cache'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { toRecordId } from '../resources/resource-id'
import { SystemUserService } from '../users/system-user-service'
import { readInventoryBridgeConfig } from './inventory-bridge-config'
import {
  advanceWatermarkCAS,
  deleteInventoryBridgeLink,
  listInventoryBridgeLinksForConnector,
  upsertInventoryBridgeLink,
} from './inventory-bridge-store'

const logger = createScopedLogger('inventory-bridge-pass')

export interface InventoryBridgePassResult {
  /** Movements created (auto mode decreases). */
  movements: number
  /** Decreases left pending because the link is in `confirm` mode. */
  pending: number
  /** Watermarks advanced with no movement (increase / first-baseline / re-point). */
  advanced: number
}

/**
 * Read the current synced quantity for a batch of source records under one field.
 * Returns a Map<instanceId, quantity>; instances with no numeric value are omitted.
 */
async function readQuantities(
  db: Database,
  organizationId: string,
  quantityFieldId: string,
  instanceIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (instanceIds.length === 0) return out
  const rows = await db
    .select({ entityId: schema.FieldValue.entityId, value: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, quantityFieldId),
        inArray(schema.FieldValue.entityId, instanceIds)
      )
    )
  for (const row of rows) {
    if (row.value != null) out.set(row.entityId, row.value)
  }
  return out
}

/**
 * Read the current related part for a batch of source records via the configured
 * relationship field (the variant-side has_one edge). Returns Map<variantId, partId|null>.
 */
async function readLinkedParts(
  db: Database,
  organizationId: string,
  relationshipFieldId: string,
  instanceIds: string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  for (const id of instanceIds) out.set(id, null)
  if (instanceIds.length === 0) return out
  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, relationshipFieldId),
        inArray(schema.FieldValue.entityId, instanceIds)
      )
    )
  for (const row of rows) {
    if (row.relatedEntityId) out.set(row.entityId, row.relatedEntityId)
  }
  return out
}

/**
 * Run the watermark pass for one connector. `targetDefIds` is the set of entity defs the
 * connector writes into — the pass only considers INVENTORY_BRIDGE sources among them.
 * Safe to call on every connector; returns early when nothing applies.
 */
export async function runInventoryBridgePass(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  targetDefIds: Iterable<string>
): Promise<InventoryBridgePassResult> {
  const result: InventoryBridgePassResult = { movements: 0, pending: 0, advanced: 0 }

  const config = await readInventoryBridgeConfig(organizationId)
  if (config.length === 0) return result

  const defs = new Set(targetDefIds)
  const active = config.filter((c) => defs.has(c.sourceDefId))
  if (active.length === 0) return result

  const links = await listInventoryBridgeLinksForConnector(db, dataConnectorId)
  if (links.length === 0) return result

  // Resolve the `part` def + stock_movement def once; skip silently if the org has neither.
  const partDefId = await getCachedEntityDefId(organizationId, 'part')
  const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
  if (!partDefId || !movementDefId) return result

  let handler: UnifiedCrudHandler | null = null

  for (const entry of active) {
    // Scope to this source's links so a link for another source def is never mistaken
    // for a cleared edge under the wrong relationship field.
    const entryLinks = links.filter((l) => l.sourceDefId === entry.sourceDefId)
    if (entryLinks.length === 0) continue
    const linkByVariant = new Map(entryLinks.map((l) => [l.variantInstanceId, l]))
    const variantIds = entryLinks.map((l) => l.variantInstanceId)
    const [quantities, linkedParts] = await Promise.all([
      readQuantities(db, organizationId, entry.quantityFieldId, variantIds),
      readLinkedParts(db, organizationId, entry.relationshipFieldId, variantIds),
    ])

    for (const variantId of variantIds) {
      const link = linkByVariant.get(variantId)
      if (!link) continue

      // The relationship is the source of truth. If the user re-pointed (or cleared) the
      // edge in the builder, reconcile the denormalized row and re-baseline — no movement.
      const currentPart = linkedParts.get(variantId) ?? null
      if (currentPart === null) {
        // Edge cleared outside the picker — drop the stale watermark.
        await deleteInventoryBridgeLink(db, variantId)
        continue
      }

      const cell = quantities.get(variantId)
      if (cell == null) continue // no synced quantity yet

      if (currentPart !== link.partInstanceId) {
        // Re-pointed link: refresh the row + re-baseline to the current cell, no movement.
        await upsertInventoryBridgeLink(db, {
          organizationId,
          dataConnectorId,
          sourceDefId: entry.sourceDefId,
          variantInstanceId: variantId,
          partInstanceId: currentPart,
          lastSeenQuantity: cell,
          mode: link.mode,
        })
        result.advanced += 1
        continue
      }

      const wm = link.lastSeenQuantity
      if (cell === wm) continue // no change

      if (cell > wm) {
        // Restock — phase 1 advances the watermark silently (no movement).
        await advanceWatermarkCAS(db, link.id, wm, cell)
        result.advanced += 1
        continue
      }

      // cell < wm — a consumption delta. In confirm mode leave it pending (non-advancing);
      // the part console surfaces + applies it. In auto mode CAS-advance then deduct.
      if (link.mode === 'confirm') {
        result.pending += 1
        continue
      }

      const won = await advanceWatermarkCAS(db, link.id, wm, cell)
      if (!won) continue // another pass handled this transition

      if (!handler) {
        const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
        handler = new UnifiedCrudHandler(organizationId, systemUserId, db)
      }

      const delta = wm - cell // positive magnitude
      await handler.create(movementDefId, {
        stock_movement_part: toRecordId(partDefId, link.partInstanceId),
        stock_movement_type: 'sale',
        stock_movement_quantity: -delta,
        stock_movement_adjust_subparts: true,
        stock_movement_reference: `inv:${dataConnectorId}:${variantId}`,
      })
      result.movements += 1
      logger.info('Inventory bridge deducted linked part', {
        organizationId,
        dataConnectorId,
        variantInstanceId: variantId,
        partInstanceId: link.partInstanceId,
        delta,
      })
    }
  }

  return result
}
