// packages/lib/src/purchasing/expense-bill/index.ts
//
// The standalone company's A/P bill: `Dr <expense> / Cr accounts_payable`, for
// rent, insurance, a legal invoice or a subscription
// (plans/accounting/tasks/21-the-books-stand-alone.md §3.2). Distinct from the
// L3 purchasing bill, which relieves GRNI and is not built.

export {
  loadVendorBill,
  loadVendorBillLines,
  requireVendorBill,
  type VendorBillLineRecord,
  type VendorBillRecord,
} from './reads'
export {
  type ExpenseBillPostInput,
  listVendorBillPostings,
  type PostExpenseBillResult,
  postExpenseBill,
  previewExpenseBill,
  type VoidExpenseBillInput,
  voidExpenseBill,
} from './writes'
