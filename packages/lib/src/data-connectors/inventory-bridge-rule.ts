// packages/lib/src/data-connectors/inventory-bridge-rule.ts
// The managed record rule that drives the v9 inventory→part deduction, plus the source
// resolver that REPLACED the retired INVENTORY_BRIDGE OrganizationSetting (v9 consolidation).
//
// ONE managed rule per inventory-source def: `entityDefinitionId = sourceDefId`,
// `fieldId = quantityFieldId`, `on: 'decreased'`, native `deductInventory` action. The
// variant↔part link + cursor + mode live in InventoryBridgeLink (one row per variant). This
// module answers "which (def, field) are inventory sources" from the org's managed rules
// (hot read via the recordRules cache) instead of a config setting, and resolves the two
// facts config also held — the relationship edge field + the syncing connector — from the
// stable edge systemAttribute and the connector mappings.
//
// Keep top-level imports light — the native handler lazy-imports the deduction engine (rule 3:
// barrels break vi.mock). The ensure/remove + resolvers here are only called from server flows.

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { getCachedRecordRules, onCacheEvent } from '../cache'
import {
  createManagedRecordRule,
  deleteManagedRecordRulesForDef,
  findManagedRecordRule,
} from '../record-rules'
import {
  DEDUCT_INVENTORY_HANDLER,
  INVENTORY_BRIDGE_EDGE_ATTR,
  INVENTORY_MANAGED_MARKER,
  INVENTORY_RULE_NAME,
} from './inventory-bridge-rule-consts'

export {
  DEDUCT_INVENTORY_HANDLER,
  INVENTORY_MANAGED_MARKER,
  INVENTORY_RULE_NAME,
} from './inventory-bridge-rule-consts'

/** A resolved inventory source — the shape config used to persist, now derived at read time. */
export interface InventorySource {
  sourceDefId: string
  quantityFieldId: string
  /** The source→part edge field id (stable systemAttribute). */
  relationshipFieldId: string
  /** The connector that syncs the source; null for a non-connector (hand-maintained) source. */
  dataConnectorId: string | null
}

/**
 * Idempotently ensure the managed deduction rule exists for a `(sourceDefId, quantityFieldId)`
 * source. First link on a def creates it; later links reuse it. Busts the recordRules cache.
 */
export async function ensureInventoryDeductionRule(
  db: Database,
  organizationId: string,
  input: { sourceDefId: string; quantityFieldId: string }
): Promise<{ id: string; created: boolean }> {
  const existing = await findManagedRecordRule(
    db,
    organizationId,
    input.sourceDefId,
    input.quantityFieldId,
    INVENTORY_MANAGED_MARKER
  )
  if (existing) return { id: existing.id, created: false }

  const row = await createManagedRecordRule(db, organizationId, {
    entityDefinitionId: input.sourceDefId,
    fieldId: input.quantityFieldId,
    name: INVENTORY_RULE_NAME,
    on: 'decreased',
    actions: [{ type: 'native', handler: DEDUCT_INVENTORY_HANDLER }],
    managed: INVENTORY_MANAGED_MARKER,
  })
  await onCacheEvent('record-rule.changed', { orgId: organizationId })
  return { id: row.id, created: true }
}

/**
 * Remove the managed deduction rule(s) for a source def (source teardown / last unlink).
 * No-op when none exist. Busts the recordRules cache when it removed anything.
 */
export async function removeInventoryDeductionRule(
  db: Database,
  organizationId: string,
  input: { sourceDefId: string }
): Promise<void> {
  const removed = await deleteManagedRecordRulesForDef(
    db,
    organizationId,
    input.sourceDefId,
    INVENTORY_MANAGED_MARKER
  )
  if (removed > 0) await onCacheEvent('record-rule.changed', { orgId: organizationId })
}

/** The `(sourceDefId, quantityFieldId)` sources from the org's managed rules (hot read). */
export async function listInventorySourceRules(
  organizationId: string
): Promise<{ sourceDefId: string; quantityFieldId: string }[]> {
  const rules = await getCachedRecordRules(organizationId)
  const out: { sourceDefId: string; quantityFieldId: string }[] = []
  for (const r of rules) {
    if (r.managed === INVENTORY_MANAGED_MARKER && r.fieldId) {
      out.push({ sourceDefId: r.entityDefinitionId, quantityFieldId: r.fieldId })
    }
  }
  return out
}

/** Resolve the source→part edge field id for a def (stable systemAttribute). Null if unprovisioned. */
export async function resolveRelationshipFieldId(
  db: Database,
  organizationId: string,
  sourceDefId: string
): Promise<string | null> {
  const row = await db.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.entityDefinitionId, sourceDefId),
      eq(schema.CustomField.systemAttribute, INVENTORY_BRIDGE_EDGE_ATTR)
    ),
  })
  return row?.id ?? null
}

/** Distinct entity defs this org has connector mappings for (the candidate inventory sources). */
export async function listSyncedDefIds(db: Database, organizationId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ defId: schema.DataConnectorMapping.entityDefinitionId })
    .from(schema.DataConnectorMapping)
    .where(eq(schema.DataConnectorMapping.organizationId, organizationId))
  return rows.map((r) => r.defId).filter((d): d is string => d != null)
}

/** Resolve the connector that syncs a source def (first mapping wins). Null for non-connector sources. */
export async function resolveConnectorForDef(
  db: Database,
  organizationId: string,
  sourceDefId: string
): Promise<string | null> {
  const [row] = await db
    .select({ dataConnectorId: schema.DataConnectorStream.dataConnectorId })
    .from(schema.DataConnectorMapping)
    .innerJoin(
      schema.DataConnectorStream,
      eq(schema.DataConnectorStream.id, schema.DataConnectorMapping.dataConnectorStreamId)
    )
    .where(
      and(
        eq(schema.DataConnectorMapping.organizationId, organizationId),
        eq(schema.DataConnectorMapping.entityDefinitionId, sourceDefId)
      )
    )
    .limit(1)
  return row?.dataConnectorId ?? null
}

/**
 * Every inventory source with its quantity field + relationship edge resolved. Used by the
 * watermark pass (backstop) and the link picker (which defs count as sources). Sources whose
 * relationship edge is missing (unprovisioned) are dropped — nothing to link/read.
 */
export async function listInventorySources(
  db: Database,
  organizationId: string
): Promise<{ sourceDefId: string; quantityFieldId: string; relationshipFieldId: string }[]> {
  const rules = await listInventorySourceRules(organizationId)
  const out: { sourceDefId: string; quantityFieldId: string; relationshipFieldId: string }[] = []
  for (const r of rules) {
    const relationshipFieldId = await resolveRelationshipFieldId(db, organizationId, r.sourceDefId)
    if (relationshipFieldId) out.push({ ...r, relationshipFieldId })
  }
  return out
}

/** Full resolution for one source def (adds the syncing connector). Null when it isn't a source. */
export async function resolveInventorySource(
  db: Database,
  organizationId: string,
  sourceDefId: string
): Promise<InventorySource | null> {
  const rules = await listInventorySourceRules(organizationId)
  const src = rules.find((r) => r.sourceDefId === sourceDefId)
  if (!src) return null
  const relationshipFieldId = await resolveRelationshipFieldId(db, organizationId, sourceDefId)
  if (!relationshipFieldId) return null
  const dataConnectorId = await resolveConnectorForDef(db, organizationId, sourceDefId)
  return { sourceDefId, quantityFieldId: src.quantityFieldId, relationshipFieldId, dataConnectorId }
}
