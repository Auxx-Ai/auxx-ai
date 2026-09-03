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

import { parseRecordId } from '@auxx/types/resource'
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
/**
 * A `tariff_rate` write is two joins away from a part (rate -> code -> every
 * offer on that code -> its part), which is why it is its own handler rather
 * than a third branch in `recalculatePartCost` (29 §7).
 */
const RECALC_PART_COST_TARIFF_RATE = 'recalculatePartCostFromTariffRate'
/**
 * Company enrichment reached from a FIELD write rather than the record's creation.
 * Two declarations share one handler: `company_domain` (a domain arriving or being
 * corrected) and `company_website` (a URL the domain can be derived from).
 */
const ENRICH_COMPANY_FROM_DOMAIN = 'enrichCompanyFromDomain'
const ENRICH_COMPANY_FROM_WEBSITE = 'enrichCompanyFromWebsite'

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
  registerNativeRuleHandler(RECALC_PART_COST_TARIFF_RATE, async (event) => {
    const { recalculatePartCostForTariffRates } = await import('./post/tariff-rate-triggers')
    await recalculatePartCostForTariffRates({
      organizationId: event.organizationId,
      rateInstanceIds: event.recordIds.map((id) => parseRecordId(id).entityInstanceId),
    })
  })

  // Company enrichment, field doors. NOT routed through `fanOutEntityHandler`: it bails on
  // any firing with no lifecycle `action`, and field firings carry none.
  registerNativeRuleHandler(ENRICH_COMPANY_FROM_DOMAIN, async (event) => {
    const { enqueueCompanyEnrichmentForRecords } = await import('./post/company-triggers')
    await enqueueCompanyEnrichmentForRecords(event, 'domain-changed')
  })
  registerNativeRuleHandler(ENRICH_COMPANY_FROM_WEBSITE, async (event) => {
    const { enqueueCompanyEnrichmentForRecords } = await import('./post/company-triggers')
    await enqueueCompanyEnrichmentForRecords(event, 'website-changed')
  })

  declareSystemRules(FIELD_SYSTEM_RULES)
}

/**
 * The field triggers, one declaration per systemAttribute. All fire `on: 'changed'` — the
 * transition the legacy registry implied (any field-value change). `vendor_part_is_preferred`
 * keeps its ORDERED pair `[recalculatePartCost, clearOtherPreferred]`.
 */
const FIELD_SYSTEM_RULES: SystemRuleDeclaration[] = [
  // The schedule (29 §7). Editing a rate row's number, day or authority moves
  // `part_cost` on every offer behind its code. Create and delete are lifecycle
  // rules in `system-entity-rules.ts`; `tariffCode` is `updatable: false`, so a
  // row can never be re-parented and needs no rule.
  ...(['tariff_rate_rate', 'tariff_rate_effective_from', 'tariff_rate_authority'] as const).map(
    (systemAttribute) => ({
      key: `mfg-${systemAttribute.replace(/_/g, '-')}`,
      name: `Recalculate part cost on ${systemAttribute} change`,
      defSlug: 'tariff-rates',
      fieldRef: { systemAttribute },
      on: 'changed' as const,
      actions: [{ type: 'native' as const, handler: RECALC_PART_COST_TARIFF_RATE }],
      skipOnCreate: true,
    })
  ),
  {
    key: 'mfg-vendor-part-unit-price',
    name: 'Recalculate part cost on vendor unit price change',
    defSlug: 'vendor-parts',
    fieldRef: { systemAttribute: 'vendor_part_unit_price' },
    on: 'changed',
    skipOnCreate: true,
    actions: [{ type: 'native', handler: RECALC_PART_COST_VENDOR }],
  },
  {
    key: 'mfg-vendor-part-shipping-cost',
    name: 'Recalculate part cost on vendor shipping cost change',
    defSlug: 'vendor-parts',
    fieldRef: { systemAttribute: 'vendor_part_shipping_cost' },
    on: 'changed',
    skipOnCreate: true,
    actions: [{ type: 'native', handler: RECALC_PART_COST_VENDOR }],
  },
  {
    key: 'mfg-vendor-part-tariff-rate',
    name: 'Recalculate part cost on vendor tariff rate change',
    defSlug: 'vendor-parts',
    fieldRef: { systemAttribute: 'vendor_part_tariff_rate' },
    on: 'changed',
    skipOnCreate: true,
    actions: [{ type: 'native', handler: RECALC_PART_COST_VENDOR }],
  },
  {
    key: 'mfg-vendor-part-tariff-code',
    name: 'Recalculate part cost on vendor tariff code change',
    defSlug: 'vendor-parts',
    fieldRef: { systemAttribute: 'vendor_part_tariff_code' },
    on: 'changed',
    skipOnCreate: true,
    actions: [{ type: 'native', handler: RECALC_PART_COST_VENDOR }],
  },
  {
    key: 'mfg-vendor-part-other-cost',
    name: 'Recalculate part cost on vendor other cost change',
    defSlug: 'vendor-parts',
    fieldRef: { systemAttribute: 'vendor_part_other_cost' },
    on: 'changed',
    skipOnCreate: true,
    actions: [{ type: 'native', handler: RECALC_PART_COST_VENDOR }],
  },
  {
    key: 'mfg-vendor-part-is-preferred',
    name: 'Recalculate cost and clear other preferred on preferred change',
    defSlug: 'vendor-parts',
    fieldRef: { systemAttribute: 'vendor_part_is_preferred' },
    on: 'changed',
    skipOnCreate: true,
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
    skipOnCreate: true,
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
  // ─── Company enrichment field doors ──────────────────────────────────
  //
  // `'changed'`, not `'set'`. `'set'` is `isEmpty(old) && !isEmpty(new)`, which misses a
  // CORRECTION (`acme.com` to `acme.io`) — and a correction is exactly when the cached
  // logo and description are wrong. On the interactive door the two behave identically
  // anyway (the sentinel makes every transition match), so `'set'` would buy nothing and
  // lose the case that matters.
  //
  // `skipOnCreate` suppresses the interactive create double-fire. It does NOT suppress the
  // sync one: `handle-sync-record-rules.ts` never consults the flag, so an import creating
  // a company with a domain fires this rule AND `company-created`. That is absorbed by the
  // BullMQ jobId dedupe and the stored status, not here (see `companies/enrichment/guards.ts`).
  {
    key: 'company-domain-changed',
    name: 'Enrich company when its domain changes',
    defSlug: 'companies',
    fieldRef: { systemAttribute: 'company_domain' },
    on: 'changed',
    skipOnCreate: true,
    actions: [{ type: 'native', handler: ENRICH_COMPANY_FROM_DOMAIN }],
  },
  {
    key: 'company-website-changed',
    name: 'Enrich company when its website changes',
    defSlug: 'companies',
    fieldRef: { systemAttribute: 'company_website' },
    on: 'changed',
    skipOnCreate: true,
    actions: [{ type: 'native', handler: ENRICH_COMPANY_FROM_WEBSITE }],
  },
]

/** Test-only: reset the one-time registration latch. */
export function __resetFieldSystemRulesLatch(): void {
  registered = false
}
