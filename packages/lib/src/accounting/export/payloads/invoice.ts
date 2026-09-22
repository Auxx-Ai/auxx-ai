// packages/lib/src/accounting/export/payloads/invoice.ts
// A shipment (every `fulfillment` posting, 91 §8.13)
// or a standalone `invoice_issued` posting - a QuickBooks Invoice (plan 67 §1-2).

import { z } from 'zod/v4'
import { baseShape, counterpartySchema, isoDateSchema, itemLineSchema, sumLines } from './shared'

export const INVOICE_OBJECT_TYPE = 'invoice'

export const exportInvoiceSchema = z
  .object({
    ...baseShape,
    customer: counterpartySchema,
    storeId: z.string().nullable(),
    lines: z.array(itemLineSchema).min(1),
    dueDate: isoDateSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (sumLines(value.lines) !== value.totalMinor)
      ctx.addIssue({ code: 'custom', message: "An invoice's lines must sum to its total" })
  })

export type ExportInvoicePayload = z.infer<typeof exportInvoiceSchema>
