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

export {
  PAYOUT_STATUSES,
  type PayoutItem,
  type PayoutSplit,
  type PayoutStatus,
  resolvePayoutStatus,
  splitPayout,
} from './payouts/client'
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

// ─── Bank deposits (plans/accounting/tasks/06-deposit-grouping.md, slot 1D) ──
// The client-safe half only: constants, the status union, and the pure route
// and grouping helpers the deposits page reads. Nothing here imports a database.
export {
  BANK_DEPOSIT_SOURCE_TYPE,
  type BankDepositStatus,
  DEFAULT_PAYMENT_ROUTES,
  groupByDay,
  isBankDepositFrozen,
  methodsRoutedToUndepositedFunds,
  PAYMENT_ROUTE_SETTING_KEYS,
  PAYMENT_ROUTE_SETTING_OPTIONS,
  type PaymentRoute,
  type PaymentRouteMethod,
  resolveBankDepositStatus,
  resolvePaymentRoute,
} from './bank-deposits/client'
// ─── The shared batch-posting frame (accounting/25 §5) ─────────────────────
// The vocabulary both bulk posters render. `FULFILLMENT_POSTING_GROUPINGS` and
// the credit memo module's grouping are both aliases of these, so the dialog
// can be written against one name.
export {
  BATCH_POSTING_EXCLUSION_REASONS,
  BATCH_POSTING_GROUPINGS,
  type BatchPostingExclusionReason,
  type BatchPostingGrouping,
} from './batch-posting/client'
// ─── Bulk credit memo posting (plans/accounting/tasks/25) ──────────────────
// The client-safe half only: the closed exclusion-reason set the dialog renders
// a total `Record` over, and the plan/summary wire shapes.
export {
  CREDIT_MEMO_BATCH_SOURCE_TYPE,
  CREDIT_MEMO_GL_POSTING_ATTRIBUTE,
  CREDIT_MEMO_POSTING_EXCLUSION_REASONS,
  type CreditMemoAmounts,
  type CreditMemoPostingExclusion,
  type CreditMemoPostingExclusionReason,
  type CreditMemoPostingGroup,
  type CreditMemoPostingGrouping,
  type CreditMemoPostingPlan,
  type CreditMemoPostingPlanInput,
  type CreditMemoPostingRef,
  type CreditMemoPostingRequest,
  type CreditMemoPostingRunSummary,
  type PlannedCreditMemo,
  type UnpostedCreditMemo,
} from './credit-memo-posting/client'
// ─── Credit memos (plans/accounting/tasks/10-credit-memos.md) ──────────────
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
  type CreditMemoSettlement,
  type CreditMemoSource,
  type CreditMemoStatus,
  type OpenInvoiceRow,
  type PlannedCreditApplication,
  planCreditApplication,
} from './credit-memos/client'
// ─── Bulk fulfillment posting (plans/money/tasks/49-bulk-fulfillment-posting.md) ──
// The client-safe half only: the groupings, the closed exclusion-reason set the
// dialog renders a total `Record` over, and the plan/summary wire shapes.
// Appended as one block, per HANDOFF §9a's rule for shared barrels.
export {
  FULFILLMENT_BATCH_SOURCE_TYPE,
  FULFILLMENT_POSTING_EXCLUSION_REASONS,
  FULFILLMENT_POSTING_GROUPINGS,
  FULFILLMENT_POSTING_MODES,
  FULFILLMENT_POSTING_SETTING_KEY,
  type FulfillmentDebitRole,
  type FulfillmentPostingExclusion,
  type FulfillmentPostingExclusionReason,
  type FulfillmentPostingGroup,
  type FulfillmentPostingGrouping,
  type FulfillmentPostingMode,
  type FulfillmentPostingPlan,
  type FulfillmentPostingPlanInput,
  type FulfillmentPostingRequest,
  type FulfillmentPostingRunSummary,
  type OrderFulfillmentPostingRef,
  type PlannedShipment,
  type ShipmentAmounts,
  type UnpostedShipment,
  type UnpostedShipmentLine,
} from './fulfillment-posting/client'
// ─── Order fulfillment (HANDOFF slot 2G) ────────────────────────────────────
// The client-safe half only: the shipment-log shape and the pure functions over
// it, which the fulfill dialog reads to prefill remaining quantities.
export {
  fulfillmentStatusFor,
  nextFulfillmentSequence,
  ORDER_FULFILLMENT_SOURCE_TYPE,
  type OrderFulfillment,
  type OrderFulfillmentLine,
  type OrderFulfillmentsEnvelope,
  type OrderLineRemaining,
  shippedByLine,
  shippedSubtotalMinor,
  shippingStillOwed,
} from './orders/client'
