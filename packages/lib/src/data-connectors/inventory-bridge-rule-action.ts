// packages/lib/src/data-connectors/inventory-bridge-rule-action.ts
// The `deductInventory` native rule action — the fast/visible path of the v9 inventory→part
// bridge. Registered from `registerAllHooks()` (field-hooks bootstrap) so both web + worker see
// it. The managed rule (`inventory-bridge-rule.ts`) fires this on a source's quantity `decreased`;
// per changed variant it loads the InventoryBridgeLink, reads the CURRENT cell + linked part, and
// calls the shared `deductVariantInventory` core (same code the backstop pass runs). The delta is
// always `cursor − cell` (never the manifest old-value) — that is what self-heals dupes / lost
// firings. The `on: decreased` match only GATES the firing; the cursor computes the amount.
//
// Keep top-level imports light (drizzle only) — the deduction engine, store, cache, crud + system
// user are lazy-imported inside the handler (rule 3: barrels break vi.mock). Never throws — the
// engine records a per-action failure and moves on.

import { and, eq } from 'drizzle-orm'
import { type NativeRuleHandler, registerNativeRuleHandler } from '../record-rules'
import {
  DEDUCT_INVENTORY_HANDLER,
  INVENTORY_BRIDGE_EDGE_ATTR,
  INVENTORY_MANAGED_MARKER,
} from './inventory-bridge-rule-consts'

let registered = false

/**
 * Register the `deductInventory` native handler. Idempotent — safe under repeated init.
 * Called from `registerAllHooks()`.
 */
export function registerInventoryDeductionRule(): void {
  if (registered) return
  registered = true
  registerNativeRuleHandler(DEDUCT_INVENTORY_HANDLER, deductInventoryHandler)
}

/** Test-only: reset the one-time registration latch. */
export function __resetInventoryDeductionRuleLatch(): void {
  registered = false
}

const deductInventoryHandler: NativeRuleHandler = async (event) => {
  const { organizationId, recordIds } = event
  if (recordIds.length === 0) return

  const { database, schema } = await import('@auxx/database')
  const { parseRecordId } = await import('@auxx/types/resource')
  const { getCachedEntityDefId, getCachedRecordRules } = await import('../cache')
  const { getInventoryBridgeLink } = await import('./inventory-bridge-store')
  const { deductVariantInventory } = await import('./inventory-bridge-pass')
  const { UnifiedCrudHandler } = await import('../resources/crud/unified-handler')
  const { SystemUserService } = await import('../users/system-user-service')

  const [partDefId, movementDefId] = await Promise.all([
    getCachedEntityDefId(organizationId, 'part'),
    getCachedEntityDefId(organizationId, 'stock_movement'),
  ])
  if (!partDefId || !movementDefId) return

  // Quantity field per source def, from the managed rules (the rule that fired is one of them).
  const rules = await getCachedRecordRules(organizationId)
  const quantityFieldByDef = new Map<string, string>()
  for (const r of rules) {
    if (r.managed === INVENTORY_MANAGED_MARKER && r.fieldId) {
      quantityFieldByDef.set(r.entityDefinitionId, r.fieldId)
    }
  }

  // Read the current numeric cell for one source record under its quantity field.
  const readCell = async (entityId: string, quantityFieldId: string): Promise<number | null> => {
    const [row] = await database
      .select({ value: schema.FieldValue.valueNumber })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.entityId, entityId),
          eq(schema.FieldValue.fieldId, quantityFieldId)
        )
      )
      .limit(1)
    return row?.value ?? null
  }

  // Read the current linked part via the stable edge systemAttribute (source of truth).
  const readLinkedPart = async (entityId: string): Promise<string | null> => {
    const [row] = await database
      .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.entityId, entityId),
          eq(schema.CustomField.systemAttribute, INVENTORY_BRIDGE_EDGE_ATTR)
        )
      )
      .limit(1)
    return row?.relatedEntityId ?? null
  }

  let handlerPromise: Promise<InstanceType<typeof UnifiedCrudHandler>> | null = null
  const getHandler = () => {
    if (!handlerPromise) {
      handlerPromise = (async () => {
        const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
        return new UnifiedCrudHandler(organizationId, systemUserId, database)
      })()
    }
    return handlerPromise
  }

  const { createScopedLogger } = await import('@auxx/logger')
  const logger = createScopedLogger('inventory-bridge-rule-action')

  for (const recordId of recordIds) {
    try {
      const { entityInstanceId } = parseRecordId(recordId)
      const link = await getInventoryBridgeLink(database, entityInstanceId)
      if (!link) continue // unlinked variant changed — nothing to do
      const quantityFieldId = quantityFieldByDef.get(link.sourceDefId)
      if (!quantityFieldId) continue // rule for this def not resolvable — skip

      const [cell, currentPart] = await Promise.all([
        readCell(entityInstanceId, quantityFieldId),
        readLinkedPart(entityInstanceId),
      ])

      await deductVariantInventory(database, {
        organizationId,
        dataConnectorId: link.dataConnectorId,
        sourceDefId: link.sourceDefId,
        link,
        cell,
        currentPart,
        partDefId,
        movementDefId,
        getHandler,
      })
    } catch (error) {
      // Never let one bad link abort the batch — the engine records the handler outcome, but
      // a per-record throw would drop the rest. Log + continue (parity with the backstop pass).
      logger.error('deductInventory failed for a record', {
        organizationId,
        recordId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
