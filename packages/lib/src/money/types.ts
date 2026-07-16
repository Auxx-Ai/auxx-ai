// packages/lib/src/money/types.ts

import type { RecordId } from '@auxx/types/resource'
import type { RecurrencePattern } from '../recurrence'

/** Percent-of-subtotal vs flat-amount discount (mirrors `QUOTE_DISCOUNT_TYPE_OPTIONS`). */
export type DiscountType = 'percent' | 'amount'

/**
 * A single line item's contribution to document totals — the minimal shape
 * `computeDocumentTotals` needs (money MQ1 build spec §F.1).
 */
export interface LineForTotals {
  /** `qty * unitPrice` in integer cents, already computed (roundCents). `null` when `unitPrice` is null. */
  lineTotal: number | null
  taxable: boolean
}

/** Document-level billing inputs (the quote's own fields) driving discount + tax math. */
export interface DocumentBillingInputs {
  discountType?: DiscountType | null
  discountValue?: number | null
  /** Percent, e.g. `7.5` for 7.5%. */
  taxRate?: number | null
}

/** Computed document totals — mirrors the three stored quote fields. */
export interface DocumentTotals {
  subtotal: number
  discountAmount: number
  taxTotal: number
  total: number
}

/** Shared base for money mutations — always org/user scoped. */
export interface MoneyMutationInput {
  organizationId: string
  userId: string
}

/** Input for `markQuoteSent` / `approveQuote` / `declineQuote`. */
export interface QuoteLifecycleInput extends MoneyMutationInput {
  /** EntityInstance id of the quote (not the RecordId). */
  quoteInstanceId: string
}

/** Input for `createQuoteFromRequest`. */
export interface CreateQuoteFromRequestInput extends MoneyMutationInput {
  /** EntityInstance id of the source service request (not the RecordId). */
  requestInstanceId: string
}

/** Input for `convertQuoteToWorkOrder`. */
export interface ConvertQuoteToWorkOrderInput extends MoneyMutationInput {
  /** EntityInstance id of the quote (not the RecordId). */
  quoteInstanceId: string
}

/** Input for `reorderLines`. */
export interface ReorderLinesInput extends MoneyMutationInput {
  /** The quote (or work order) the lines belong to — context only, not required for the write. */
  documentRecordId?: RecordId
  /** EntityInstance ids of the line items, in their new order. */
  orderedLineInstanceIds: string[]
}

/**
 * Input for `recomputeTotals` — the delete-path + drift escape hatch (§F.2/§G.2), generalized
 * across quote/invoice (money MI1 build spec §G.1). The legacy quote-only shape (bare
 * `quoteInstanceId`, no `documentType`) is still accepted so existing call sites keep
 * compiling unchanged — it's treated as `documentType: 'quote'`.
 */
export interface RecomputeTotalsInput extends MoneyMutationInput {
  documentType?: 'quote' | 'invoice'
  /** EntityInstance id of the quote or invoice (not the RecordId). */
  documentInstanceId?: string
  /** @deprecated legacy shape — pass `documentInstanceId` + `documentType: 'quote'` instead. */
  quoteInstanceId?: string
}

/** How a payment was collected — mirrors `PAYMENT_METHOD_OPTIONS` (money MI1 build spec §B.2). */
export type PaymentMethod = 'cash' | 'check' | 'card' | 'bank' | 'other'

/** Input for `markInvoiceSent` / `voidInvoice` / `deleteInvoice` (§G.2/§G.4/§G.5). */
export interface InvoiceLifecycleInput extends MoneyMutationInput {
  /** EntityInstance id of the invoice (not the RecordId). */
  invoiceInstanceId: string
}

/** Input for `recordManualPayment` (money MI1 build spec §E.2). */
export interface RecordManualPaymentInput extends MoneyMutationInput {
  /** EntityInstance id of the invoice (not the RecordId). */
  invoiceInstanceId: string
  /** Integer cents (the MQ1 convention). */
  amount: number
  /** ISO date string (`yyyy-MM-dd`) — the date the payment was made (may be backdated). */
  date: string
  method: PaymentMethod
  reference?: string
  note?: string
}

/** Input for `deleteManualPayment` (§E.2). */
export interface DeleteManualPaymentInput extends MoneyMutationInput {
  /** `PaymentTransaction.id`. */
  transactionId: string
}

/** Input for `listWorkOrderPayments` — the job page's cross-invoice payments read (money
 * work-order billing tab build spec §A). */
export interface ListWorkOrderPaymentsInput extends MoneyMutationInput {
  /** EntityInstance id of the work order (not the RecordId). */
  workOrderInstanceId: string
}

/** Input for `syncInvoicePaymentState` — the ledger → invoice mirror projection (§E.4). */
export interface SyncInvoicePaymentStateInput extends MoneyMutationInput {
  /** EntityInstance id of the invoice (not the RecordId). */
  invoiceInstanceId: string
}

/** Input for `listUninvoicedLines` (§G.3). */
export interface ListUninvoicedLinesInput extends MoneyMutationInput {
  /** EntityInstance id of the work order (not the RecordId). */
  workOrderInstanceId: string
}

/** A work-order line not yet stamped onto any invoice — the gather dialog's row shape (§G.3). */
export interface UninvoicedLine {
  recordId: RecordId
  instanceId: string
  name: string
  description?: string
  qty: number
  unitPrice: number | null
  lineTotal: number | null
  taxable: boolean
  /** Plain-text bridge to `WorkOrderVisit` — undefined for job-set (non-visit) lines. */
  visitId?: string
}

/** Input for `createInvoiceFromWorkOrder` (§G.3). */
export interface CreateInvoiceFromWorkOrderInput extends MoneyMutationInput {
  /** EntityInstance id of the work order (not the RecordId). */
  workOrderInstanceId: string
  /** EntityInstance ids of the work-order lines to gather (whole-line only, decision 7). */
  lineInstanceIds: string[]
}

/** Result of `createInvoiceFromWorkOrder` — the records-view drawer-open convention. */
export interface CreateInvoiceFromWorkOrderResult {
  recordId: RecordId
  instanceId: string
}

/** Billing basis configured on a work order. */
export type WorkOrderBillingBasis = 'fixed_contract' | 'per_visit' | 'recurring_flat'

/** Invoice timing controls when configured work becomes eligible, not how it is priced. */
export type WorkOrderInvoiceTiming =
  | 'per_visit_completed'
  | 'on_completion'
  | 'as_needed'
  | 'custom_schedule'

/** Read-optimized next-action state projected onto a work order. */
export type WorkOrderBillingState =
  | 'attention_required'
  | 'ready_to_invoice'
  | 'draft_pending'
  | 'awaiting_payment'
  | 'scheduled'
  | 'paid'
  | 'not_ready'

/** Why an invoice was produced from a work order. */
export type InvoiceBillingKind =
  | 'full_contract'
  | 'progress'
  | 'visit'
  | 'recurring_flat'
  | 'extra_work'
  | 'standalone'

/** Explicit amount selection for a fixed-contract invoice. */
export type FixedContractInvoiceAmount =
  | { type: 'remaining' }
  | { type: 'percentage'; value: number }
  | { type: 'fixed'; amount: number }
  | { type: 'installment'; installmentId: string }

/** Shared input for allocation-backed work-order billing commands. */
export interface WorkOrderBillingCommandInput extends MoneyMutationInput {
  /** EntityInstance id of the work order. */
  workOrderInstanceId: string
}

/** Create a full, progress, or scheduled fixed-contract invoice. */
export interface CreateFixedContractInvoiceInput extends WorkOrderBillingCommandInput {
  amount: FixedContractInvoiceAmount
}

/** Create one invoice containing one or more completed visits. */
export interface CreateVisitInvoiceInput extends WorkOrderBillingCommandInput {
  visitIds: string[]
}

/** Create one flat-rate charge for a recurrence occurrence or a manual period. */
export interface CreateRecurringChargeInput extends WorkOrderBillingCommandInput {
  occurrenceDate?: string
}

/** Create a separate invoice for additive visit work. */
export interface CreateExtraWorkInvoiceInput extends WorkOrderBillingCommandInput {
  visitIds: string[]
  sourceLineIds?: string[]
}

/** Convert unallocated visit additions into fixed-contract source lines. */
export interface AddVisitExtrasToContractInput extends WorkOrderBillingCommandInput {
  visitId: string
}

/** Editable row accepted by the fixed-contract payment-schedule command. */
export interface BillingInstallmentInput {
  name: string
  calculation: 'percentage' | 'fixed'
  percentageBasisPoints?: number
  amount?: number
  trigger: 'manual' | 'date' | 'work_order_completion'
  scheduledDate?: string
}

/** Replace the pending portion of a fixed-contract payment schedule. */
export interface SaveBillingInstallmentsInput extends WorkOrderBillingCommandInput {
  installments: BillingInstallmentInput[]
}

/** Allocation-backed billing summary for a work order. All amounts are integer cents. */
export interface WorkOrderBillingProjection {
  basis: WorkOrderBillingBasis
  timing: WorkOrderInvoiceTiming
  state: WorkOrderBillingState
  billingAmount: number
  amountDrafted: number
  amountInvoiced: number
  uninvoicedAmount: number
  balanceDue: number
  invoiceCount: number
  nextInvoiceDate: string | null
  attentionReason?: string
}

/** Input for `deleteInvoiceLine` (§G.3). */
export interface DeleteInvoiceLineInput extends MoneyMutationInput {
  /** EntityInstance id of the line item (not the RecordId). */
  lineInstanceId: string
}

/** The three automated invoice-draft triggers (money MI2 build spec §C). */
export type InvoiceDraftTrigger = 'per_visit' | 'on_completion' | 'custom_schedule'

/** Input for `generateInvoiceDraft` (§C) — one function all three triggers call. */
export interface GenerateInvoiceDraftInput {
  organizationId: string
  /** EntityInstance id of the work order (not the RecordId). */
  workOrderInstanceId: string
  trigger: InvoiceDraftTrigger
  /** `per_visit` only — the dedup key (`invoice_visit_id`) + extras filter. */
  visitId?: string
  /** `custom_schedule` only — the occurrence's scheduled local date, used for dedup/logging
   * context and (Q9b, `visit_date` date basis) the backdated `issuedAt`. */
  occurrenceDate?: string
  /** `per_visit` only — the visit's own local date (`WorkOrderVisit.occurrenceDate` else the
   * date part of `startTime`), used for the Q9b backdated `issuedAt`. */
  visitDate?: string
}

/** Result of `generateInvoiceDraft` — a skip carries a `reason` for logging/telemetry. */
export type GenerateInvoiceDraftResult =
  | {
      created: false
      reason: 'disabled' | 'not_found' | 'timing_mismatch' | 'no_contact' | 'duplicate' | 'empty'
    }
  | { created: true; recordId: RecordId; instanceId: string }

/** Input for `setInvoiceSchedule` (§F.1). */
export interface SetInvoiceScheduleInput {
  organizationId: string
  userId: string
  /** EntityInstance id of the work order (not the RecordId). */
  workOrderInstanceId: string
  pattern: RecurrencePattern
  timezone: string
}

/** Input shared by `clearInvoiceSchedule` / `getInvoiceSchedule` (§F.1/§J). */
export interface InvoiceScheduleQueryInput {
  organizationId: string
  /** EntityInstance id of the work order (not the RecordId). */
  workOrderInstanceId: string
}
