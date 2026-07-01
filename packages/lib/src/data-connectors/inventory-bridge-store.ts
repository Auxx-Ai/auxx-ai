// packages/lib/src/data-connectors/inventory-bridge-store.ts
// Functional queries over InventoryBridgeLink — the per-link watermark store for the
// v9 inventory→part consumption bridge. Drizzle, no model class (project convention).
// The watermark pass (inventory-bridge-pass.ts) reads links for a connector and advances
// each with a compare-and-swap so concurrent passes (a steered run finishing while the
// sweep runs) emit exactly one movement per transition.
// See plans/data-connectors/v9/shopify-inventory-part-bridge-plan.md (Piece B2/C).

import { type Database, type InventoryBridgeLinkEntity, schema } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'

export type InventoryBridgeMode = 'auto' | 'confirm'

/** All watermark links for a connector (the pass iterates these post-sync). */
export async function listInventoryBridgeLinksForConnector(
  db: Database,
  dataConnectorId: string
): Promise<InventoryBridgeLinkEntity[]> {
  return db
    .select()
    .from(schema.InventoryBridgeLink)
    .where(eq(schema.InventoryBridgeLink.dataConnectorId, dataConnectorId))
}

/** Watermark links pointing at a given part (for the part-detail console). */
export async function listInventoryBridgeLinksForPart(
  db: Database,
  organizationId: string,
  partInstanceId: string
): Promise<InventoryBridgeLinkEntity[]> {
  return db
    .select()
    .from(schema.InventoryBridgeLink)
    .where(
      and(
        eq(schema.InventoryBridgeLink.organizationId, organizationId),
        eq(schema.InventoryBridgeLink.partInstanceId, partInstanceId)
      )
    )
}

/** The single watermark link for an inventory-source (variant) record, if any. */
export async function getInventoryBridgeLink(
  db: Database,
  variantInstanceId: string
): Promise<InventoryBridgeLinkEntity | undefined> {
  const [row] = await db
    .select()
    .from(schema.InventoryBridgeLink)
    .where(eq(schema.InventoryBridgeLink.variantInstanceId, variantInstanceId))
    .limit(1)
  return row
}

/**
 * Create (or re-baseline) the watermark for a variant↔part link. Initialized to the
 * variant's current synced quantity so opening stock is never deducted ("from now").
 * Re-pointing the link to a different part, or re-linking, updates in place and
 * re-baselines the watermark — no movement is ever emitted from this call.
 */
export async function upsertInventoryBridgeLink(
  db: Database,
  input: {
    organizationId: string
    dataConnectorId: string
    sourceDefId: string
    variantInstanceId: string
    partInstanceId: string
    lastSeenQuantity: number
    mode?: InventoryBridgeMode
  }
): Promise<InventoryBridgeLinkEntity> {
  const now = new Date()
  const [row] = await db
    .insert(schema.InventoryBridgeLink)
    .values({
      id: generateId(),
      organizationId: input.organizationId,
      dataConnectorId: input.dataConnectorId,
      sourceDefId: input.sourceDefId,
      variantInstanceId: input.variantInstanceId,
      partInstanceId: input.partInstanceId,
      lastSeenQuantity: input.lastSeenQuantity,
      mode: input.mode ?? 'confirm',
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.InventoryBridgeLink.variantInstanceId,
      set: {
        // Re-point + re-baseline. mode is preserved unless explicitly overridden.
        dataConnectorId: input.dataConnectorId,
        sourceDefId: input.sourceDefId,
        partInstanceId: input.partInstanceId,
        lastSeenQuantity: input.lastSeenQuantity,
        ...(input.mode ? { mode: input.mode } : {}),
        updatedAt: now,
      },
    })
    .returning()
  return row
}

/**
 * Compare-and-swap the watermark. Advances `lastSeenQuantity` from `expected` to `next`
 * only if it still equals `expected`; returns true when this caller won the transition.
 * The single winner is what makes the pass idempotent + race-safe against concurrent runs.
 */
export async function advanceWatermarkCAS(
  db: Database,
  linkId: string,
  expected: number,
  next: number
): Promise<boolean> {
  const won = await db
    .update(schema.InventoryBridgeLink)
    .set({ lastSeenQuantity: next, updatedAt: new Date() })
    .where(
      and(
        eq(schema.InventoryBridgeLink.id, linkId),
        eq(schema.InventoryBridgeLink.lastSeenQuantity, expected)
      )
    )
    .returning({ id: schema.InventoryBridgeLink.id })
  return won.length > 0
}

/** Set the apply mode (`auto`/`confirm`) for a link. */
export async function setInventoryBridgeLinkMode(
  db: Database,
  variantInstanceId: string,
  mode: InventoryBridgeMode
): Promise<void> {
  await db
    .update(schema.InventoryBridgeLink)
    .set({ mode, updatedAt: new Date() })
    .where(eq(schema.InventoryBridgeLink.variantInstanceId, variantInstanceId))
}

/** Remove the watermark for a variant (on unlink). */
export async function deleteInventoryBridgeLink(
  db: Database,
  variantInstanceId: string
): Promise<void> {
  await db
    .delete(schema.InventoryBridgeLink)
    .where(eq(schema.InventoryBridgeLink.variantInstanceId, variantInstanceId))
}
