// packages/lib/src/purchasing/bill-intake/index.ts

/**
 * Bill intake: a vendor's invoice in, a draft vendor bill out, its lines linked
 * to the purchase order's lines where the paper says so
 * (plans/money/tasks/58-vendor-bill-from-the-invoice.md).
 *
 * Server entrypoint. Client code imports `@auxx/lib/purchasing/bill-intake/client`,
 * never this barrel: the barrel reaches the LLM orchestrator, Redis and the
 * storage layer.
 */

export { assignBillLines, descriptionTokens, diceSimilarity, foldKey } from './assign'
export { type ExistingBill, findExistingBill } from './duplicate'
export { findOrderByReference } from './find-order'
export {
  type LinkBillLineInput,
  type LinkBillLinesInput,
  linkBillLines,
  linkBillLineToOrderLine,
  resolveGrniAccountId,
} from './link'
export {
  type BillLineFactsLoad,
  loadBillLineFacts,
  type StoredBillLineFacts,
} from './load-bill-lines'
export { loadOrderLineFacts } from './load-order-lines'
export { type BillLineProposals, proposeBillLineLinks } from './propose'
export { type InvoiceVendorResolution, resolveInvoiceVendor } from './resolve-vendor'
export {
  type BillIntakeRunCreatedResult,
  billIntakeRunKey,
  billIntakeRunPointerKey,
  type CreateBillIntakeRunInput,
  createBillIntakeRun,
  discardBillIntakeRun,
  failBillIntakeRun,
  getBillIntakeRun,
  getBillIntakeRunForBill,
  markBillIntakeRunCreated,
  parkBillIntakeRunForVendor,
  readStoredBillIntakeRun,
  resumeBillIntakeRun,
  type StoredBillIntakeRun,
  setBillIntakeRunPhase,
  toBillIntakeRunView,
  updateBillIntakeRun,
} from './run-store'
export {
  INVOICE_TRANSCRIBE_SPEC,
  parseTranscribedInvoice,
  TRANSCRIBE_INVOICE_PROMPT,
  TRANSCRIBED_INVOICE_JSON_SCHEMA,
} from './schema'
export { transcribeInvoice } from './transcribe'
