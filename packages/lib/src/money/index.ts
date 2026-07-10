// packages/lib/src/money/index.ts
//
// Server entrypoint for the money (quoting) feature — totals engine, quote lifecycle
// mutations, convert-to-work-order, and line reordering (money MQ1 build spec §F).
// Functional + neverthrow-style, no model classes (dashboards module is the layout
// precedent, dispatch is the direct sibling for this feature).

export { convertQuoteToWorkOrder } from './convert-quote'
export {
  approveQuote,
  createQuoteFromRequest,
  declineQuote,
  markQuoteSent,
} from './quote-lifecycle'
export { reorderLines } from './reorder'
export { computeDocumentTotals, computeLineTotal, roundCents } from './totals'
export {
  recomputeOnLineChange,
  recomputeOnQuoteBillingChange,
  recomputeTotals,
} from './totals-hooks'
export type {
  ConvertQuoteToWorkOrderInput,
  CreateQuoteFromRequestInput,
  DiscountType,
  DocumentBillingInputs,
  DocumentTotals,
  LineForTotals,
  MoneyMutationInput,
  QuoteLifecycleInput,
  RecomputeTotalsInput,
  ReorderLinesInput,
} from './types'
