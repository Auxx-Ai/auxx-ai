// packages/lib/src/accounting/export/payloads/index.ts
// Every export payload shape, and the discriminated parse that turns a stored
// `ExportBatch.objectType` + `payload` back into one (plan 67 §2).

import { UnprocessableEntityError } from '../../../errors'
import { BILL_OBJECT_TYPE, exportBillSchema } from './bill'
import { CREDIT_MEMO_OBJECT_TYPE, exportCreditMemoSchema } from './credit-memo'
import { DEPOSIT_OBJECT_TYPE, exportDepositSchema } from './deposit'
import { exportInvoiceSchema, INVOICE_OBJECT_TYPE } from './invoice'
import { JOURNAL_OBJECT_TYPE, parseExportJournal } from './journal'
import { exportPaymentSchema, PAYMENT_OBJECT_TYPE } from './payment'
import { exportRefundReceiptSchema, REFUND_RECEIPT_OBJECT_TYPE } from './refund-receipt'
import { exportSalesReceiptSchema, SALES_RECEIPT_OBJECT_TYPE } from './sales-receipt'
import { exportVendorCreditSchema, VENDOR_CREDIT_OBJECT_TYPE } from './vendor-credit'

export {
  BILL_OBJECT_TYPE,
  type ExportBillLine,
  type ExportBillPayload,
  exportBillSchema,
} from './bill'
export {
  CREDIT_MEMO_OBJECT_TYPE,
  type ExportCreditMemoPayload,
  exportCreditMemoSchema,
} from './credit-memo'
export {
  DEPOSIT_OBJECT_TYPE,
  type ExportDepositLine,
  type ExportDepositPayload,
  exportDepositSchema,
} from './deposit'
export { type ExportInvoicePayload, exportInvoiceSchema, INVOICE_OBJECT_TYPE } from './invoice'
export {
  type ExportJournalLine,
  type ExportJournalPayload,
  exportJournalSchema,
  hashExportPayload,
  JOURNAL_OBJECT_TYPE,
  parseExportJournal,
} from './journal'
export { type ExportPaymentPayload, exportPaymentSchema, PAYMENT_OBJECT_TYPE } from './payment'
export {
  type ExportRefundReceiptPayload,
  exportRefundReceiptSchema,
  REFUND_RECEIPT_OBJECT_TYPE,
} from './refund-receipt'
export {
  type ExportSalesReceiptPayload,
  exportSalesReceiptSchema,
  SALES_RECEIPT_OBJECT_TYPE,
} from './sales-receipt'
export {
  type ExportVendorCreditLine,
  type ExportVendorCreditPayload,
  exportVendorCreditSchema,
  VENDOR_CREDIT_OBJECT_TYPE,
} from './vendor-credit'

/** Every object type an export batch may carry (plan 67 §1's mapping table). */
export const EXPORT_OBJECT_TYPES = [
  JOURNAL_OBJECT_TYPE,
  SALES_RECEIPT_OBJECT_TYPE,
  INVOICE_OBJECT_TYPE,
  PAYMENT_OBJECT_TYPE,
  CREDIT_MEMO_OBJECT_TYPE,
  REFUND_RECEIPT_OBJECT_TYPE,
  DEPOSIT_OBJECT_TYPE,
  BILL_OBJECT_TYPE,
  VENDOR_CREDIT_OBJECT_TYPE,
] as const

export type ExportObjectType = (typeof EXPORT_OBJECT_TYPES)[number]

/**
 * Every `gl_account` id a frozen payload names, de-duplicated (89 D7).
 *
 * A recursive walk rather than nine shape-specific readers, so a tenth payload
 * shape cannot silently drop out of the Ready tab's preflight.
 */
export function payloadAccountIds(payload: unknown): string[] {
  const found = new Set<string>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry)
      return
    }
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (key === 'glAccountId' && typeof value === 'string') found.add(value)
      else walk(value)
    }
  }
  walk(payload)
  return [...found]
}

/** Parse an opaque stored payload back into its object type's shape. Throws on drift. */
export function parseExportPayload(objectType: string, payload: unknown): unknown {
  switch (objectType) {
    case JOURNAL_OBJECT_TYPE:
      return parseExportJournal(payload)
    case SALES_RECEIPT_OBJECT_TYPE:
      return exportSalesReceiptSchema.parse(payload)
    case INVOICE_OBJECT_TYPE:
      return exportInvoiceSchema.parse(payload)
    case PAYMENT_OBJECT_TYPE:
      return exportPaymentSchema.parse(payload)
    case CREDIT_MEMO_OBJECT_TYPE:
      return exportCreditMemoSchema.parse(payload)
    case REFUND_RECEIPT_OBJECT_TYPE:
      return exportRefundReceiptSchema.parse(payload)
    case DEPOSIT_OBJECT_TYPE:
      return exportDepositSchema.parse(payload)
    case BILL_OBJECT_TYPE:
      return exportBillSchema.parse(payload)
    case VENDOR_CREDIT_OBJECT_TYPE:
      return exportVendorCreditSchema.parse(payload)
    default:
      throw new UnprocessableEntityError(`Unknown export object type '${objectType}'`)
  }
}
