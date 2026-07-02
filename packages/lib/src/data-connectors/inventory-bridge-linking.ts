// packages/lib/src/data-connectors/inventory-bridge-linking.ts
// B3 server surface — link/unlink an inventory-source record (e.g. a shopify_variants row)
// to a `part`, plus the per-link mode toggle and the part-console read. Functional (no model
// class); the tRPC router is a thin wrapper. Linking sets the source→part relationship value
// AND creates the watermark row initialized to the source's CURRENT quantity ("from now" — no
// movement), so opening stock is never deducted. Optional baseline seed sets the part's QoH to
// the source level via one `adjust` movement (opening stock must NOT cascade to sub-parts).
// See plans/data-connectors/v9/shopify-inventory-part-bridge-plan.md (Piece B3).

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { getCachedEntityDefId, requireCachedEntityDefId } from '../cache'
import { BadRequestError, NotFoundError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { toRecordId } from '../resources/resource-id'
import { INVENTORY_BRIDGE_EDGE_ATTR } from './inventory-bridge-provisioning'
import {
  type InventorySource,
  listInventorySources,
  resolveInventorySource,
} from './inventory-bridge-rule'
import {
  advanceWatermarkCAS,
  deleteInventoryBridgeLink,
  getInventoryBridgeLink,
  type InventoryBridgeMode,
  listInventoryBridgeLinksForPart,
  setInventoryBridgeLinkMode,
  upsertInventoryBridgeLink,
} from './inventory-bridge-store'

/** Read a single numeric field value for one instance (by fieldId). */
async function readNumberValue(
  db: Database,
  organizationId: string,
  entityId: string,
  fieldId: string
): Promise<number | null> {
  const [row] = await db
    .select({ value: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, entityId),
        eq(schema.FieldValue.fieldId, fieldId)
      )
    )
    .limit(1)
  return row?.value ?? null
}

/** Read a numeric value by the field's systemAttribute (used for the computed part QoH). */
async function readNumberBySystemAttr(
  db: Database,
  organizationId: string,
  entityId: string,
  systemAttribute: string
): Promise<number | null> {
  const [row] = await db
    .select({ value: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, entityId),
        eq(schema.CustomField.systemAttribute, systemAttribute)
      )
    )
    .limit(1)
  return row?.value ?? null
}

/** The configured inventory sources (picker asks this to know which defs are sources). */
export async function listInventoryBridgeSources(
  db: Database,
  organizationId: string
): Promise<{ sourceDefId: string; quantityFieldId: string; relationshipFieldId: string }[]> {
  return listInventorySources(db, organizationId)
}

/** Resolve a configured source or throw — the source must have a managed rule + a connector. */
async function requireSource(
  db: Database,
  organizationId: string,
  sourceDefId: string
): Promise<InventorySource> {
  const source = await resolveInventorySource(db, organizationId, sourceDefId)
  if (!source) {
    throw new NotFoundError(`No inventory source configured for def ${sourceDefId}`)
  }
  return source
}

export interface LinkInventorySourceInput {
  partInstanceId: string
  variantInstanceId: string
  sourceDefId: string
  mode?: InventoryBridgeMode
  /** Option G — set the part's QoH to the source's current level now (one `adjust` movement). */
  baselineSeed?: boolean
}

/**
 * Link a source record to a part: set the relationship value + create the watermark row at
 * the source's current quantity (no movement). Optionally baseline-seed the part QoH.
 */
export async function linkInventorySource(
  db: Database,
  organizationId: string,
  userId: string,
  input: LinkInventorySourceInput
): Promise<void> {
  const source = await requireSource(db, organizationId, input.sourceDefId)
  if (!source.dataConnectorId) {
    throw new BadRequestError(`Inventory source ${input.sourceDefId} has no syncing connector`)
  }
  const partDefId = await requireCachedEntityDefId(organizationId, 'part')

  const crud = new UnifiedCrudHandler(organizationId, userId, db)
  // Set the source→part edge (slug-keyed like create; fires inverse sync so
  // part.soldAsVariants updates too). The edge always carries INVENTORY_BRIDGE_EDGE_ATTR.
  await crud.update(toRecordId(input.sourceDefId, input.variantInstanceId), {
    [INVENTORY_BRIDGE_EDGE_ATTR]: toRecordId(partDefId, input.partInstanceId),
  })

  const currentQty =
    (await readNumberValue(db, organizationId, input.variantInstanceId, source.quantityFieldId)) ??
    0

  await upsertInventoryBridgeLink(db, {
    organizationId,
    dataConnectorId: source.dataConnectorId,
    sourceDefId: input.sourceDefId,
    variantInstanceId: input.variantInstanceId,
    partInstanceId: input.partInstanceId,
    lastSeenQuantity: currentQty,
    mode: input.mode,
  })

  if (input.baselineSeed) {
    const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
    if (movementDefId) {
      const partQoH =
        (await readNumberBySystemAttr(
          db,
          organizationId,
          input.partInstanceId,
          'part_quantity_on_hand'
        )) ?? 0
      const delta = currentQty - partQoH
      if (delta !== 0) {
        // Opening-stock adjustment — NEVER cascade to sub-parts (adjustSubparts: false).
        await crud.create(movementDefId, {
          stock_movement_part: toRecordId(partDefId, input.partInstanceId),
          stock_movement_type: 'adjust',
          stock_movement_quantity: delta,
          stock_movement_adjust_subparts: false,
          stock_movement_reason: 'Inventory bridge baseline seed',
        })
      }
    }
  }
}

/** Unlink: clear the relationship value + delete the watermark row. */
export async function unlinkInventorySource(
  db: Database,
  organizationId: string,
  userId: string,
  input: { variantInstanceId: string; sourceDefId: string }
): Promise<void> {
  await requireSource(db, organizationId, input.sourceDefId) // guard: must be a configured source
  const crud = new UnifiedCrudHandler(organizationId, userId, db)
  await crud.update(toRecordId(input.sourceDefId, input.variantInstanceId), {
    [INVENTORY_BRIDGE_EDGE_ATTR]: null,
  })
  await deleteInventoryBridgeLink(db, input.variantInstanceId)
}

/**
 * Apply a `confirm`-mode link's pending consumption delta: CAS-advance the watermark and
 * create the `sale` movement (BOM explosion) — the user-triggered counterpart of the auto
 * path. No-op if the source has since risen back to (or above) the watermark. Returns the
 * applied magnitude (0 when nothing was pending).
 */
export async function applyPendingInventoryDelta(
  db: Database,
  organizationId: string,
  userId: string,
  variantInstanceId: string
): Promise<number> {
  const link = await getInventoryBridgeLink(db, variantInstanceId)
  if (!link) throw new NotFoundError(`No inventory bridge link for ${variantInstanceId}`)
  const source = await requireSource(db, organizationId, link.sourceDefId)

  const current =
    (await readNumberValue(db, organizationId, variantInstanceId, source.quantityFieldId)) ?? null
  if (current == null || current >= link.lastSeenQuantity) return 0

  const won = await advanceWatermarkCAS(db, link.id, link.lastSeenQuantity, current)
  if (!won) return 0

  const partDefId = await requireCachedEntityDefId(organizationId, 'part')
  const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
  if (!movementDefId) return 0

  const delta = link.lastSeenQuantity - current
  const crud = new UnifiedCrudHandler(organizationId, userId, db)
  await crud.create(movementDefId, {
    stock_movement_part: toRecordId(partDefId, link.partInstanceId),
    stock_movement_type: 'sale',
    stock_movement_quantity: -delta,
    stock_movement_adjust_subparts: true,
    stock_movement_reference: `inv:${link.dataConnectorId}:${variantInstanceId}`,
  })
  return delta
}

/** Toggle a link between `auto` and `confirm`. */
export async function updateInventoryLinkMode(
  db: Database,
  variantInstanceId: string,
  mode: InventoryBridgeMode
): Promise<void> {
  const existing = await getInventoryBridgeLink(db, variantInstanceId)
  if (!existing) throw new NotFoundError(`No inventory bridge link for ${variantInstanceId}`)
  await setInventoryBridgeLinkMode(db, variantInstanceId, mode)
}

export interface PartInventoryLink {
  variantInstanceId: string
  sourceDefId: string
  mode: InventoryBridgeMode
  /** Watermark (last quantity the bridge accounted for). */
  lastSeenQuantity: number
  /** Current synced quantity on the source record (null if not yet synced). */
  currentQuantity: number | null
  /** Pending consumption delta for a `confirm`-mode link (0 for auto / no decrease). */
  pendingDelta: number
}

/**
 * The part-console read (Option F): every inventory link on a part with its watermark, the
 * source's current quantity, and the pending confirm-mode delta the user can apply.
 */
export async function listPartInventoryLinks(
  db: Database,
  organizationId: string,
  partInstanceId: string
): Promise<PartInventoryLink[]> {
  const links = await listInventoryBridgeLinksForPart(db, organizationId, partInstanceId)
  if (links.length === 0) return []
  const sources = await listInventorySources(db, organizationId)
  const quantityFieldByDef = new Map(sources.map((s) => [s.sourceDefId, s.quantityFieldId]))
  const out: PartInventoryLink[] = []
  for (const link of links) {
    const quantityFieldId = quantityFieldByDef.get(link.sourceDefId)
    const currentQuantity = quantityFieldId
      ? await readNumberValue(db, organizationId, link.variantInstanceId, quantityFieldId)
      : null
    const pendingDelta =
      link.mode === 'confirm' && currentQuantity != null && currentQuantity < link.lastSeenQuantity
        ? link.lastSeenQuantity - currentQuantity
        : 0
    out.push({
      variantInstanceId: link.variantInstanceId,
      sourceDefId: link.sourceDefId,
      mode: link.mode,
      lastSeenQuantity: link.lastSeenQuantity,
      currentQuantity,
      pendingDelta,
    })
  }
  return out
}
