// packages/lib/src/money/types.ts

import type { RecordId } from '@auxx/types/resource'

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

/** Input for `recomputeTotals` — the delete-path + drift escape hatch (§F.2/§G.2). */
export interface RecomputeTotalsInput extends MoneyMutationInput {
  /** EntityInstance id of the quote (not the RecordId). */
  quoteInstanceId: string
}
