// packages/lib/src/field-hooks/system-entity-rules.ts
// B2 §9 (unification): the manufacturing ENTITY_TRIGGERS (BOM cost on vendor-part/subpart
// change, stock-movement BOM explosion + QoH, company website enrichment), re-expressed as
// server-declared lifecycle record rules with native actions. Replaces the legacy
// ENTITY_TRIGGERS registry (deleted in the same cut-over). Declared + handlers registered
// from `registerAllHooks()`.
//
// The native handlers receive `eventDataByRecordId` (raw create/delete-time values threaded
// from the dispatching door — interactive `event.data.eventData`, sync `manifest.createdValues`)
// so the wrapped trigger functions see the SAME raw `values` they always did, with NO DB
// refetch (a refetch is wrong for the transient `stock_movement_adjust_subparts` flag — see
// plans/events/b2-phase9-option-a-plan.md Part 1).
//
// Keep top-level imports light — the trigger functions (bom/realtime/http/db) are lazy-imported
// inside the wrappers so loading this module never drags those in (rule 2 — barrels break vi.mock).

import { parseRecordId } from '@auxx/types/resource'
import type { NativeRuleHandlerEvent } from '../record-rules/actions'
import { registerNativeRuleHandler } from '../record-rules/actions'
import type { SystemRuleDeclaration } from '../record-rules/system-rules'
import { declareSystemRules } from '../record-rules/system-rules'
import type { EntityTriggerEvent, EntityTriggerHandler } from './types'

const ENTITY_COST_RECALC_VENDOR = 'entityCostRecalcVendor'
const ENTITY_COST_RECALC_SUBPART = 'entityCostRecalcSubpart'
const DERIVE_PART_KIND = 'derivePartKind'
const EXPLODE_BOM_MOVEMENT = 'explodeBomMovement'
const RECALC_PART_QOH = 'recalculatePartQoH'
const ENRICH_COMPANY_ON_CREATE = 'enrichCompanyOnCreate'
const RECALC_PO_LINE_RECEIVED = 'recalculatePurchaseOrderLineReceived'
const RECALC_PO_LINE_BILLED = 'recalculatePurchaseOrderLineBilled'

/**
 * Fan a batch native event out to a single-record `EntityTriggerHandler`, reconstructing the
 * legacy `EntityTriggerEvent` per record from the threaded raw values. Entity triggers are
 * lifecycle-only — a firing with no `action` (a field-change firing) is ignored.
 */
async function fanOutEntityHandler(
  event: NativeRuleHandlerEvent,
  entitySlug: string,
  handler: EntityTriggerHandler
): Promise<void> {
  const action = event.action
  if (!action) return
  for (const recordId of event.recordIds) {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    const values = event.eventDataByRecordId?.[recordId] ?? {}
    const entityEvent: EntityTriggerEvent = {
      action,
      entitySlug,
      entityType: '', // not read by any migrated handler; derive from slug if ever needed
      entityDefinitionId,
      entityInstanceId,
      organizationId: event.organizationId,
      userId: event.userId ?? '',
      values,
    }
    await handler(entityEvent)
  }
}

let registered = false

/**
 * Declare the manufacturing entity system rules and register their native handlers. Called
 * from `registerAllHooks()` at field-hooks bootstrap. Idempotent — safe under repeated init.
 */
export function registerEntitySystemRules(): void {
  if (registered) return
  registered = true

  // Cost recalc — BATCH across the whole firing (dedup-friendly on bulk imports). The def
  // fixes the relationship attr, so vendor and subpart get distinct handler keys.
  registerNativeRuleHandler(ENTITY_COST_RECALC_VENDOR, async (event) => {
    const { recalculatePartCostForEntityBatch } = await import('./post/bom-cost-triggers')
    await recalculatePartCostForEntityBatch({
      organizationId: event.organizationId,
      relationshipAttr: 'vendor_part_part',
      action: event.action,
      records: event.recordIds.map((rid) => ({
        entityInstanceId: parseRecordId(rid).entityInstanceId,
        values: event.eventDataByRecordId?.[rid],
      })),
    })
  })
  registerNativeRuleHandler(ENTITY_COST_RECALC_SUBPART, async (event) => {
    const { recalculatePartCostForEntityBatch } = await import('./post/bom-cost-triggers')
    await recalculatePartCostForEntityBatch({
      organizationId: event.organizationId,
      relationshipAttr: 'subpart_parent_part',
      action: event.action,
      records: event.recordIds.map((rid) => ({
        entityInstanceId: parseRecordId(rid).entityInstanceId,
        values: event.eventDataByRecordId?.[rid],
      })),
    })
  })

  // `part_kind` from the bill of materials (plans/money/tasks/23 §4) — BATCH, and declared
  // BEFORE the subpart cost recalc on the same rule. The recalc ends in
  // `ensureFirstStandardCosts`, and `absorbsConversionCost` is false for a `component`, so a
  // roll that ran first would freeze a standard with no conversion cost in it on exactly the
  // parts this promotion exists to make buildable.
  registerNativeRuleHandler(DERIVE_PART_KIND, async (event) => {
    const { derivePartKindForSubpartBatch } = await import('./post/part-kind-derivation')
    await derivePartKindForSubpartBatch({
      organizationId: event.organizationId,
      records: event.recordIds.map((rid) => ({
        entityInstanceId: parseRecordId(rid).entityInstanceId,
        values: event.eventDataByRecordId?.[rid],
      })),
    })
  })

  // Stock movement explosion + QoH — per-record (each movement resolves its own part). Order
  // within the created rule is [explode, qoh]; explode clears the parent adjust-subparts flag,
  // and because we thread the ORIGINAL create values, qoh's `adjust_subparts` skip stays correct.
  registerNativeRuleHandler(EXPLODE_BOM_MOVEMENT, async (event) => {
    const { explodeBomMovement } = await import('./post/bom-movement-triggers')
    await fanOutEntityHandler(event, 'stock-movements', explodeBomMovement)
  })
  registerNativeRuleHandler(RECALC_PART_QOH, async (event) => {
    const { recalculatePartQoH } = await import('./post/inventory-triggers')
    await fanOutEntityHandler(event, 'stock-movements', recalculatePartQoH)
  })

  // Purchase order line subledger roll-ups (plans/purchasing/01-build-plan.md §4.2) —
  // per-record, each child resolves its own PO line. Both re-SUM whole and are the ONLY
  // writers of the two `computed: true` fields; a child carrying no PO line is a no-op.
  registerNativeRuleHandler(RECALC_PO_LINE_RECEIVED, async (event) => {
    const { recalculatePurchaseOrderLineReceived } = await import(
      './post/purchase-order-line-rollups'
    )
    await fanOutEntityHandler(event, 'stock-movements', recalculatePurchaseOrderLineReceived)
  })
  registerNativeRuleHandler(RECALC_PO_LINE_BILLED, async (event) => {
    const { recalculatePurchaseOrderLineBilled } = await import(
      './post/purchase-order-line-rollups'
    )
    await fanOutEntityHandler(event, 'vendor-bill-lines', recalculatePurchaseOrderLineBilled)
  })

  // Company enrichment — created only, per-record (HTTP fetch).
  registerNativeRuleHandler(ENRICH_COMPANY_ON_CREATE, async (event) => {
    const { enrichCompanyOnCreate } = await import('./post/company-triggers')
    await fanOutEntityHandler(event, 'companies', enrichCompanyOnCreate)
  })

  declareSystemRules(ENTITY_SYSTEM_RULES)
}

/**
 * Lifecycle system rules, one declaration per (defSlug, on) pair. defSlugs are the apiSlugs
 * the legacy `registerEntityTriggers` keyed on; they resolve via the entityDefSlugs cache.
 */
const ENTITY_SYSTEM_RULES: SystemRuleDeclaration[] = [
  {
    key: 'mfg-vendor-parts-created',
    name: 'Recalculate part cost on vendor part create',
    defSlug: 'vendor-parts',
    on: 'created',
    actions: [{ type: 'native', handler: ENTITY_COST_RECALC_VENDOR }],
  },
  {
    key: 'mfg-vendor-parts-deleted',
    name: 'Recalculate part cost on vendor part delete',
    defSlug: 'vendor-parts',
    on: 'deleted',
    actions: [{ type: 'native', handler: ENTITY_COST_RECALC_VENDOR }],
  },
  {
    key: 'mfg-subparts-created',
    name: 'Derive part kind and recalculate part cost on subpart create',
    defSlug: 'subparts',
    on: 'created',
    // ORDER MATTERS — promote the parent to `subassembly` BEFORE the recalc rolls it.
    // See `post/part-kind-derivation.ts` for why, and for why this promotion is the ONLY
    // one the derivation makes.
    actions: [
      { type: 'native', handler: DERIVE_PART_KIND },
      { type: 'native', handler: ENTITY_COST_RECALC_SUBPART },
    ],
  },
  {
    key: 'mfg-subparts-deleted',
    name: 'Recalculate part cost on subpart delete',
    defSlug: 'subparts',
    on: 'deleted',
    // 🛑 No `DERIVE_PART_KIND` here, deliberately (23 §4.3 decision 2). A subassembly whose
    // last subpart was removed is a data question, and auto-demoting would silently restate
    // its standard cost; the kind stays and a human changes it.
    actions: [{ type: 'native', handler: ENTITY_COST_RECALC_SUBPART }],
  },
  {
    key: 'mfg-stock-movements-created',
    name: 'Explode BOM movement, recalculate QoH and PO line qty received on stock movement create',
    defSlug: 'stock-movements',
    on: 'created',
    // ORDER MATTERS — explode child movements BEFORE recalculating the parent's QoH.
    actions: [
      { type: 'native', handler: EXPLODE_BOM_MOVEMENT },
      { type: 'native', handler: RECALC_PART_QOH },
      { type: 'native', handler: RECALC_PO_LINE_RECEIVED },
    ],
  },
  {
    key: 'mfg-stock-movements-deleted',
    name: 'Recalculate QoH and PO line qty received on stock movement delete',
    defSlug: 'stock-movements',
    on: 'deleted',
    actions: [
      { type: 'native', handler: RECALC_PART_QOH },
      { type: 'native', handler: RECALC_PO_LINE_RECEIVED },
    ],
  },
  {
    key: 'purchasing-vendor-bill-lines-created',
    name: 'Recalculate purchase order line qty billed on bill line create',
    defSlug: 'vendor-bill-lines',
    on: 'created',
    actions: [{ type: 'native', handler: RECALC_PO_LINE_BILLED }],
  },
  {
    key: 'purchasing-vendor-bill-lines-deleted',
    name: 'Recalculate purchase order line qty billed on bill line delete',
    defSlug: 'vendor-bill-lines',
    on: 'deleted',
    actions: [{ type: 'native', handler: RECALC_PO_LINE_BILLED }],
  },
  {
    key: 'mfg-companies-created',
    name: 'Enrich company from website on create',
    defSlug: 'companies',
    on: 'created',
    actions: [{ type: 'native', handler: ENRICH_COMPANY_ON_CREATE }],
  },
]

/** Test-only: reset the one-time registration latch. */
export function __resetEntitySystemRulesLatch(): void {
  registered = false
}
