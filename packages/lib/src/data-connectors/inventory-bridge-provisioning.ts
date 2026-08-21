// packages/lib/src/data-connectors/inventory-bridge-provisioning.ts
// B1 — provision the visible link substrate for the v9 inventory→part bridge, part-side,
// at connector finish/first-sync. Given the identified inventory-source def + its quantity
// field, this idempotently creates the relationship edge (source `belongs_to` part, with a
// `soldAsVariants` has_many inverse on part) and ensures the MANAGED inventory rule (which now
// declares the source, replacing the retired INVENTORY_BRIDGE config). Skips when no `part` def.
//
// The connector manifest never declares `→ part` (locked D1): the caller supplies which def
// is the inventory source + its quantity field (e.g. Piece A's shopify_variants stream). The
// edge is a NORMAL relationship field (user-editable, builder-traversable), not an owned/
// sink-written field — the picker sets its value; the sink never touches it.
// See plans/data-connectors/v9/shopify-inventory-part-bridge-plan.md (Piece B1).

import { type Database, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getCachedEntityDefId } from '../cache'
import { createCustomField } from '../custom-fields'
import { ensureInventoryDeductionRule } from './inventory-bridge-rule'
import { INVENTORY_BRIDGE_EDGE_ATTR } from './inventory-bridge-rule-consts'

const logger = createScopedLogger('inventory-bridge-provisioning')

// Re-exported for existing importers (linking, action). The canonical definition lives in the
// leaf consts module to keep provisioning ⇄ rule acyclic.
export { INVENTORY_BRIDGE_EDGE_ATTR } from './inventory-bridge-rule-consts'

export interface ProvisionInventoryBridgeInput {
  /** The connector that syncs the inventory source (provenance/logging only; optional). */
  dataConnectorId?: string
  /** The synced inventory-source entity def (e.g. shopify_variants). */
  sourceDefId: string
  /** The NUMBER field on the source the pass compares to the watermark. */
  quantityFieldId: string
  /** App slug for the created field's provenance (optional). */
  appSlug?: string
}

/**
 * Idempotently provision the bridge edge + managed rule for one inventory source. Returns the
 * edge field id (the source's `relationshipFieldId`), or null when the org has no `part`
 * def (nothing to link to — skip silently).
 */
export async function provisionInventoryBridge(
  db: Database,
  organizationId: string,
  input: ProvisionInventoryBridgeInput
): Promise<{ relationshipFieldId: string } | null> {
  const partDefId = await getCachedEntityDefId(organizationId, 'part')
  if (!partDefId) return null

  // Idempotency: reuse the edge field if a prior provision already created it.
  const existing = await db.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.entityDefinitionId, input.sourceDefId),
      eq(schema.CustomField.systemAttribute, INVENTORY_BRIDGE_EDGE_ATTR)
    ),
  })

  let relationshipFieldId = existing?.id
  if (!relationshipFieldId) {
    // Primary lives on the SOURCE (belongs_to part) so the created field IS the edge the
    // pass reads by; the has_many inverse (`soldAsVariants`) is auto-created on part.
    const result = await createCustomField(
      {
        organizationId,
        entityDefinitionId: input.sourceDefId,
        name: 'Part',
        // 'RELATIONSHIP' is the FieldType enum value (the enum object is a type-only
        // export here, so the string literal is the runtime-safe way to pass it).
        type: 'RELATIONSHIP' as FieldType,
        systemAttribute: INVENTORY_BRIDGE_EDGE_ATTR,
        appSlug: input.appSlug,
        isCreatable: true,
        isUpdatable: true,
        relationship: {
          relatedResourceId: partDefId,
          relationshipType: 'belongs_to',
          inverseName: 'Sold as variants',
        },
      },
      db
    )
    if (result.isErr()) {
      // A name collision (field already present under a different attr) is benign — the
      // config still needs writing, but we can't resolve an id here, so bail loudly.
      throw new Error(`inventory bridge edge provisioning failed: ${result.error.message}`)
    }
    relationshipFieldId = result.value.id
    logger.info('provisioned inventory bridge edge', {
      organizationId,
      dataConnectorId: input.dataConnectorId,
      sourceDefId: input.sourceDefId,
      relationshipFieldId,
    })
  }

  // The source is now declared by a MANAGED record rule (single source of truth), not a
  // config setting. Idempotent — the first provision creates it, later ones reuse it.
  await ensureInventoryDeductionRule(db, organizationId, {
    sourceDefId: input.sourceDefId,
    quantityFieldId: input.quantityFieldId,
  })

  return { relationshipFieldId }
}
