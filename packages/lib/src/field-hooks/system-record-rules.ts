// packages/lib/src/field-hooks/system-record-rules.ts
// B2 §8 (unification): the load-bearing manufacturing FIELD_TRIGGERS, re-expressed as
// server-declared record rules with native actions. Replaces the legacy FIELD_TRIGGERS
// registry (deleted). Declared here and registered from `registerAllHooks()` (mirroring
// where the legacy `registerFieldTriggers` calls lived), so both the web and worker sides
// see them once the field-hooks bootstrap runs. The native handlers are THIN wrappers over
// the existing trigger functions — their bodies are unchanged; the wrappers only adapt the
// engine's batch event shape (`NativeRuleHandlerEvent`) to each function's `FieldTriggerEvent`.
//
// Keep top-level imports light — the trigger functions (which pull @auxx/database, bom,
// realtime, field-value-mutations) are lazy-imported inside the wrappers so loading this
// module never drags those in.

import { registerNativeRuleHandler } from '../record-rules/actions'
import type { SystemRuleDeclaration } from '../record-rules/system-rules'
import { declareSystemRules } from '../record-rules/system-rules'
import type { FieldTriggerEvent } from './types'

/**
 * `recalculatePartCost` branches on `systemAttribute.startsWith('vendor_part')` to pick the
 * parent-relationship field, and otherwise only logs it. It is invoked for two record
 * families — vendor parts and subparts — so we register two handler keys that each supply a
 * representative systemAttribute of the right family. (The exact vendor field, e.g.
 * shipping_cost vs unit_price, is irrelevant to the branch; only the `vendor_part` prefix is.)
 */
const RECALC_PART_COST_VENDOR = 'recalculatePartCostFromVendorPart'
const RECALC_PART_COST_SUBPART = 'recalculatePartCostFromSubpart'
const CLEAR_OTHER_PREFERRED = 'clearOtherPreferred'
const RECALC_STOCK_STATUS = 'recalculateStockStatus'

/** Adapt a native batch event to the legacy `FieldTriggerEvent` shape. */
function asFieldTriggerEvent(
  event: { recordIds: FieldTriggerEvent['recordIds']; organizationId: string; userId?: string },
  systemAttribute: FieldTriggerEvent['systemAttribute']
): FieldTriggerEvent {
  return {
    action: 'updated',
    systemAttribute,
    recordIds: event.recordIds,
    organizationId: event.organizationId,
    // The wrapped trigger functions never read userId; default it for type compatibility.
    userId: event.userId ?? '',
  }
}

let registered = false

/**
 * Declare the manufacturing field system rules and register their native handlers. Called
 * from `registerAllHooks()` at field-hooks bootstrap. Idempotent — safe under repeated init.
 */
export function registerFieldSystemRules(): void {
  if (registered) return
  registered = true

  registerNativeRuleHandler(RECALC_PART_COST_VENDOR, async (event) => {
    const { recalculatePartCost } = await import('./post/bom-cost-triggers')
    await recalculatePartCost(asFieldTriggerEvent(event, 'vendor_part_unit_price'))
  })
  registerNativeRuleHandler(RECALC_PART_COST_SUBPART, async (event) => {
    const { recalculatePartCost } = await import('./post/bom-cost-triggers')
    await recalculatePartCost(asFieldTriggerEvent(event, 'subpart_quantity'))
  })
  registerNativeRuleHandler(CLEAR_OTHER_PREFERRED, async (event) => {
    const { clearOtherPreferred } = await import('./post/vendor-part-triggers')
    await clearOtherPreferred(asFieldTriggerEvent(event, 'vendor_part_is_preferred'))
  })
  registerNativeRuleHandler(RECALC_STOCK_STATUS, async (event) => {
    const { recalculateStockStatus } = await import('./post/inventory-triggers')
    await recalculateStockStatus(asFieldTriggerEvent(event, 'part_reorder_point'))
  })

  declareSystemRules(FIELD_SYSTEM_RULES)
}

/**
 * The 7 field triggers, one declaration per systemAttribute. All fire `on: 'changed'` — the
 * transition the legacy registry implied (any field-value change). `vendor_part_is_preferred`
 * keeps its ORDERED pair `[recalculatePartCost, clearOtherPreferred]`.
 */
const FIELD_SYSTEM_RULES: SystemRuleDeclaration[] = [
  {
    key: 'mfg-vendor-part-unit-price',
    name: 'Recalculate part cost on vendor unit price change',
    defSlug: 'vendor-parts',
    fieldRef: { systemAttribute: 'vendor_part_unit_price' },
    on: 'changed',
    actions: [{ type: 'native', handler: RECALC_PART_COST_VENDOR }],
  },
  {
    key: 'mfg-vendor-part-shipping-cost',
    name: 'Recalculate part cost on vendor shipping cost change',
    defSlug: 'vendor-parts',
    fieldRef: { systemAttribute: 'vendor_part_shipping_cost' },
    on: 'changed',
    actions: [{ type: 'native', handler: RECALC_PART_COST_VENDOR }],
  },
  {
    key: 'mfg-vendor-part-tariff-rate',
    name: 'Recalculate part cost on vendor tariff rate change',
    defSlug: 'vendor-parts',
    fieldRef: { systemAttribute: 'vendor_part_tariff_rate' },
    on: 'changed',
    actions: [{ type: 'native', handler: RECALC_PART_COST_VENDOR }],
  },
  {
    key: 'mfg-vendor-part-other-cost',
    name: 'Recalculate part cost on vendor other cost change',
    defSlug: 'vendor-parts',
    fieldRef: { systemAttribute: 'vendor_part_other_cost' },
    on: 'changed',
    actions: [{ type: 'native', handler: RECALC_PART_COST_VENDOR }],
  },
  {
    key: 'mfg-vendor-part-is-preferred',
    name: 'Recalculate cost and clear other preferred on preferred change',
    defSlug: 'vendor-parts',
    fieldRef: { systemAttribute: 'vendor_part_is_preferred' },
    on: 'changed',
    // ORDER MATTERS — recalculate cost, THEN clear the sibling preferred flags.
    actions: [
      { type: 'native', handler: RECALC_PART_COST_VENDOR },
      { type: 'native', handler: CLEAR_OTHER_PREFERRED },
    ],
  },
  {
    key: 'mfg-subpart-quantity',
    name: 'Recalculate part cost on subpart quantity change',
    defSlug: 'subparts',
    fieldRef: { systemAttribute: 'subpart_quantity' },
    on: 'changed',
    actions: [{ type: 'native', handler: RECALC_PART_COST_SUBPART }],
  },
  {
    key: 'mfg-part-reorder-point',
    name: 'Recalculate stock status on reorder point change',
    defSlug: 'parts',
    fieldRef: { systemAttribute: 'part_reorder_point' },
    on: 'changed',
    actions: [{ type: 'native', handler: RECALC_STOCK_STATUS }],
  },
]

/** Test-only: reset the one-time registration latch. */
export function __resetFieldSystemRulesLatch(): void {
  registered = false
}
