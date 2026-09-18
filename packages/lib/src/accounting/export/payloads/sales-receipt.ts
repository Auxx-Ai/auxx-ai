// packages/lib/src/accounting/export/payloads/sales-receipt.ts
// A fulfillment paid in full at shipment: its revenue lines plus the receipt
// posting's deposit account, sent as one QuickBooks SalesReceipt (plan 67 §1-2).

import { z } from 'zod/v4'
import { baseShape, counterpartySchema, glRefSchema, itemLineSchema, sumLines } from './shared'

export const SALES_RECEIPT_OBJECT_TYPE = 'sales_receipt'

export const exportSalesReceiptSchema = z
  .object({
    ...baseShape,
    /** `null` -> the channel placeholder (Summary mode; unused while Summary stays `journal`). */
    customer: counterpartySchema.nullable(),
    storeId: z.string().nullable(),
    lines: z.array(itemLineSchema).min(1),
    /** The receipt's clearing/bank debit - where the sale's cash landed. */
    depositTo: glRefSchema,
  })
  .superRefine((value, ctx) => {
    if (sumLines(value.lines) !== value.totalMinor)
      ctx.addIssue({ code: 'custom', message: "A sales receipt's lines must sum to its total" })
  })

export type ExportSalesReceiptPayload = z.infer<typeof exportSalesReceiptSchema>
