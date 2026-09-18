// packages/lib/src/postings/export/payloads/refund-receipt.ts
// A `refund` posting (`Dr returns / Cr clearing or bank`) - a QuickBooks
// RefundReceipt (plan 67 §1-2).

import { z } from 'zod/v4'
import { baseShape, counterpartySchema, glRefSchema, itemLineSchema, sumLines } from './shared'

export const REFUND_RECEIPT_OBJECT_TYPE = 'refund_receipt'

export const exportRefundReceiptSchema = z
  .object({
    ...baseShape,
    customer: counterpartySchema,
    lines: z.array(itemLineSchema).min(1),
    /** The clearing/bank credit - where the refunded cash left from. */
    paidFrom: glRefSchema,
  })
  .superRefine((value, ctx) => {
    if (sumLines(value.lines) !== value.totalMinor)
      ctx.addIssue({ code: 'custom', message: "A refund receipt's lines must sum to its total" })
  })

export type ExportRefundReceiptPayload = z.infer<typeof exportRefundReceiptSchema>
