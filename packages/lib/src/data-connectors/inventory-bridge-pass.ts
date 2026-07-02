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

import { type Database, type InventoryBridgeLinkEntity, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedEntityDefId } from '../cache'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { toRecordId } from '../resources/resource-id'
import { SystemUserService } from '../users/system-user-service'
import { listInventorySources } from './inventory-bridge-rule'
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

/** Outcome of deducting one variant's cell against its watermark cursor. */
export type DeductVariantOutcome = 'movement' | 'pending' | 'advanced' | 'cleared' | 'noop'

export interface DeductVariantInput {
  organizationId: string
  dataConnectorId: string
  sourceDefId: string
  /** The watermark link (cursor + mode + denormalized part). */
  link: InventoryBridgeLinkEntity
  /** Current synced quantity cell; null/undefined ⇒ not yet synced (skip). */
  cell: number | null | undefined
  /** Current related part via the edge; null ⇒ edge cleared (drop the stale link). */
  currentPart: string | null
  partDefId: string
  movementDefId: string
  /** Lazily obtain the crud handler — created only when a movement is actually emitted. */
  getHandler: () => Promise<UnifiedCrudHandler>
}

/**
 * The per-variant deduction core (shared by the watermark pass AND the `deductInventory`
 * native rule action). Compares the current cell to the persisted cursor
 * (`link.lastSeenQuantity`) and, on a downward change in `auto` mode, CAS-advances the
 * cursor and emits ONE `sale` movement (`adjust_subparts` → BOM explosion). The cursor —
 * not the manifest old-value — is the delta source, which is what self-heals dupes / lost
 * firings on the next change. Running the pass and the rule on the same transition is safe:
 * whoever advances the cursor first wins the CAS; the other sees `cell == cursor` and no-ops.
 *
 * Never throws for a caller-recoverable condition; the CAS/crud calls may still reject and
 * are the caller's to guard (the rule engine's never-throws contract wraps this).
 */
export async function deductVariantInventory(
  db: Database,
  input: DeductVariantInput
): Promise<{ outcome: DeductVariantOutcome; delta?: number }> {
  const {
    link,
    currentPart,
    cell,
    organizationId,
    dataConnectorId,
    sourceDefId,
    partDefId,
    movementDefId,
  } = input
  const variantId = link.variantInstanceId

  // The relationship is the source of truth. If the user re-pointed (or cleared) the edge in
  // the builder, reconcile the denormalized row and re-baseline — no movement.
  if (currentPart === null) {
    // Edge cleared outside the picker — drop the stale watermark.
    await deleteInventoryBridgeLink(db, variantId)
    return { outcome: 'cleared' }
  }

  if (cell == null) return { outcome: 'noop' } // no synced quantity yet

  if (currentPart !== link.partInstanceId) {
    // Re-pointed link: refresh the row + re-baseline to the current cell, no movement.
    await upsertInventoryBridgeLink(db, {
      organizationId,
      dataConnectorId,
      sourceDefId,
      variantInstanceId: variantId,
      partInstanceId: currentPart,
      lastSeenQuantity: cell,
      mode: link.mode,
    })
    return { outcome: 'advanced' }
  }

  const wm = link.lastSeenQuantity
  if (cell === wm) return { outcome: 'noop' } // no change

  if (cell > wm) {
    // Restock — advance the watermark silently (no movement).
    await advanceWatermarkCAS(db, link.id, wm, cell)
    return { outcome: 'advanced' }
  }

  // cell < wm — a consumption delta. In confirm mode leave it pending (non-advancing); the
  // part console surfaces + applies it. In auto mode CAS-advance then deduct.
  if (link.mode === 'confirm') return { outcome: 'pending' }

  const won = await advanceWatermarkCAS(db, link.id, wm, cell)
  if (!won) return { outcome: 'noop' } // another pass/rule handled this transition

  const handler = await input.getHandler()
  const delta = wm - cell // positive magnitude
  await handler.create(movementDefId, {
    stock_movement_part: toRecordId(partDefId, link.partInstanceId),
    stock_movement_type: 'sale',
    stock_movement_quantity: -delta,
    stock_movement_adjust_subparts: true,
    stock_movement_reference: `inv:${dataConnectorId}:${variantId}`,
  })
  logger.info('Inventory bridge deducted linked part', {
    organizationId,
    dataConnectorId,
    variantInstanceId: variantId,
    partInstanceId: link.partInstanceId,
    delta,
  })
  return { outcome: 'movement', delta }
}

/**
 * Run the watermark pass for one connector. `targetDefIds` is the set of entity defs the
 * connector writes into — the pass only considers inventory sources among them.
 * Safe to call on every connector; returns early when nothing applies.
 */
export async function runInventoryBridgePass(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  targetDefIds: Iterable<string>
): Promise<InventoryBridgePassResult> {
  const result: InventoryBridgePassResult = { movements: 0, pending: 0, advanced: 0 }

  // Backstop sourcing: the inventory sources are now the org's managed inventory rules
  // (`managed:'inventory'`), resolved to their quantity + relationship fields — NOT a config
  // setting. The rule (fast path) and this pass (safety net) share the same cursor + CAS.
  const sources = await listInventorySources(db, organizationId)
  if (sources.length === 0) return result

  const defs = new Set(targetDefIds)
  const active = sources.filter((s) => defs.has(s.sourceDefId))
  if (active.length === 0) return result

  const links = await listInventoryBridgeLinksForConnector(db, dataConnectorId)
  if (links.length === 0) return result

  // Resolve the `part` def + stock_movement def once; skip silently if the org has neither.
  const partDefId = await getCachedEntityDefId(organizationId, 'part')
  const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
  if (!partDefId || !movementDefId) return result

  // Lazily create the crud handler once across the whole pass — only if a movement fires.
  let handlerPromise: Promise<UnifiedCrudHandler> | null = null
  const getHandler = () => {
    if (!handlerPromise) {
      handlerPromise = (async () => {
        const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
        return new UnifiedCrudHandler(organizationId, systemUserId, db)
      })()
    }
    return handlerPromise
  }

  for (const entry of active) {
    // Scope to this source's links so a link for another source def is never mistaken
    // for a cleared edge under the wrong relationship field.
    const entryLinks = links.filter((l) => l.sourceDefId === entry.sourceDefId)
    if (entryLinks.length === 0) continue
    const variantIds = entryLinks.map((l) => l.variantInstanceId)
    const [quantities, linkedParts] = await Promise.all([
      readQuantities(db, organizationId, entry.quantityFieldId, variantIds),
      readLinkedParts(db, organizationId, entry.relationshipFieldId, variantIds),
    ])

    for (const link of entryLinks) {
      const { outcome } = await deductVariantInventory(db, {
        organizationId,
        dataConnectorId,
        sourceDefId: entry.sourceDefId,
        link,
        cell: quantities.get(link.variantInstanceId),
        currentPart: linkedParts.get(link.variantInstanceId) ?? null,
        partDefId,
        movementDefId,
        getHandler,
      })
      if (outcome === 'movement') result.movements += 1
      else if (outcome === 'pending') result.pending += 1
      else if (outcome === 'advanced') result.advanced += 1
    }
  }

  return result
}
