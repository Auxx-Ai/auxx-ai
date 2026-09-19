// packages/lib/src/purchasing/expense-bill/index.ts
//
// The Post and Void actions on a vendor bill - ONE door for both kinds (73 D3):
// a bill raised against a purchase order and a bill for rent, insurance or a
// subscription are the same record, the same entry and the same posting type.

export {
  loadVendorBill,
  loadVendorBillLines,
  requireVendorBill,
  type VendorBillLineRecord,
  type VendorBillRecord,
} from './reads'
export {
  listVendorBillPostings,
  type PostVendorBillResult,
  postVendorBill,
  previewVendorBill,
  type VendorBillPostInput,
  type VoidVendorBillInput,
  voidVendorBill,
} from './writes'
