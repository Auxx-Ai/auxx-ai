// packages/lib/src/sales/client.ts

// Pure math + types/constants only — no `@auxx/database`/server deps, and deliberately NO
// 'use client' directive: this module is imported by both client components (line-builder
// footer, billing plan controller) and server code (billing-config.ts, tRPC routers via the
// `money` barrel). A 'use client' directive here turns those server-side imports into client-
// reference proxy stubs when Next bundles the RSC graph — see project memory
// "'use client' in lib client.ts breaks server imports". Lets the line-builder footer (§H.1)
// render live optimistic totals with the exact same function the server-side recompute hook
// uses (money MQ1 build spec §F.1).
import type { WorkOrderBillingBasis, WorkOrderInvoiceTiming } from './types'

export { computeDocumentTotals, computeLineTotal, roundCents } from './totals/totals'
export {
  formatLineItemUnit,
  LINE_ITEM_UNIT_OPTIONS,
  type LineItemQuantityState,
  type LineItemUnit,
  type LineItemUnitDisplayMode,
  type ParseLineItemQuantityResult,
  parseQuantityWithUnit,
} from './totals/units'
export type {
  DiscountType,
  DocumentBillingInputs,
  DocumentTotals,
  LineForTotals,
  WorkOrderBillingBasis,
  WorkOrderInvoiceTiming,
} from './types'

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

// ─── Credit memos (plans/accounting/tasks/done/10-credit-memos.md) ──────────────
// The client-safe half only: the vocabularies, the wire shapes and the pure
// planner the apply dialog prefills with. Nothing here imports a database.
export {
  type ContactCredit,
  type ContactCreditMemo,
  CREDIT_MEMO_EDITABLE_STATUSES,
  CREDIT_MEMO_LINE_DISPOSITION_OPTIONS,
  CREDIT_MEMO_LINE_DISPOSITIONS,
  CREDIT_MEMO_NUMBER_PREFIX,
  CREDIT_MEMO_POSTED_STATUSES,
  CREDIT_MEMO_REASON_LABELS,
  CREDIT_MEMO_REASON_OPTIONS,
  CREDIT_MEMO_REASONS,
  CREDIT_MEMO_SOURCE_OPTIONS,
  CREDIT_MEMO_SOURCES,
  CREDIT_MEMO_STATUS_LABELS,
  CREDIT_MEMO_STATUS_OPTIONS,
  CREDIT_MEMO_STATUSES,
  type CreditMemoApplicationRow,
  type CreditMemoForApplication,
  type CreditMemoLineDisposition,
  type CreditMemoLineInput,
  type CreditMemoReason,
  type CreditMemoRefundRow,
  type CreditMemoSource,
  type CreditMemoStatus,
  type OpenInvoiceRow,
  type PlannedCreditApplication,
  planCreditApplication,
} from './credit-memos/client'
// ─── Fulfillment records (entity migration 153, plans/money/tasks/55) ──────
// The client-safe half only: the record shapes and the pure functions over
// them - what the order drawer's ledger card and the fulfill dialog read.
export {
  defaultFulfillmentName,
  FULFILLMENT_STATUSES,
  type Fulfillment,
  type FulfillmentLine,
  type FulfillmentStatusValue,
  isLiveFulfillment,
} from './fulfillments/client'
// ─── Order fulfillment (HANDOFF slot 2G) ────────────────────────────────────
// The client-safe half only: the pure functions over an order's shipment
// history, which the fulfill dialog reads to prefill remaining quantities.
export {
  fulfillmentStatusFor,
  nextFulfillmentSequence,
  ORDER_FULFILLMENT_SOURCE_TYPE,
  type OrderLineRemaining,
  shippedByLine,
  shippedSubtotalMinor,
  shippingStillOwed,
} from './orders/client'
