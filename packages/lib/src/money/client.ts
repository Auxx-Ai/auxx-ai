// packages/lib/src/money/client.ts

// Pure math + types/constants only — no `@auxx/database`/server deps, and deliberately NO
// 'use client' directive: this module is imported by both client components (line-builder
// footer, billing plan controller) and server code (billing-config.ts, tRPC routers via the
// `money` barrel). A 'use client' directive here turns those server-side imports into client-
// reference proxy stubs when Next bundles the RSC graph — see project memory
// "'use client' in lib client.ts breaks server imports". Lets the line-builder footer (§H.1)
// render live optimistic totals with the exact same function the server-side recompute hook
// uses (money MQ1 build spec §F.1).
import type { WorkOrderBillingBasis, WorkOrderInvoiceTiming } from './types'

export { computeDocumentTotals, computeLineTotal, roundCents } from './totals'
export type {
  DiscountType,
  DocumentBillingInputs,
  DocumentTotals,
  LineForTotals,
  WorkOrderBillingBasis,
  WorkOrderInvoiceTiming,
} from './types'
export {
  formatLineItemUnit,
  LINE_ITEM_UNIT_OPTIONS,
  type LineItemQuantityState,
  type LineItemUnit,
  type LineItemUnitDisplayMode,
  type ParseLineItemQuantityResult,
  parseQuantityWithUnit,
} from './units'

/**
 * Valid invoice timings for each billing basis (work-order invoice flow plan §1.2) — the single
 * source for both the server-side `billing-config.ts` validator and every client billing-plan
 * surface. Keep as arrays (not `Set`s) so client UI can iterate/index them directly.
 */
export const COMPATIBLE_BILLING_TIMINGS: Record<WorkOrderBillingBasis, WorkOrderInvoiceTiming[]> = {
  fixed_contract: ['on_completion', 'as_needed', 'custom_schedule'],
  per_visit: ['per_visit_completed', 'on_completion', 'as_needed', 'custom_schedule'],
  recurring_flat: ['as_needed', 'custom_schedule'],
}

/** Display label for each billing basis — shared by the plan controller and billing tab. */
export const BILLING_BASIS_LABELS: Record<WorkOrderBillingBasis, string> = {
  fixed_contract: 'Fixed contract total',
  per_visit: 'Per visit',
  recurring_flat: 'Recurring flat rate',
}

/** Display label for each invoice timing — shared by the plan controller and billing tab. */
export const BILLING_TIMING_LABELS: Record<WorkOrderInvoiceTiming, string> = {
  per_visit_completed: 'After each visit',
  on_completion: 'When work is complete',
  as_needed: 'Manually',
  custom_schedule: 'On a schedule',
}
