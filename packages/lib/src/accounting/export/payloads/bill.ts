// packages/lib/src/accounting/export/payloads/bill.ts
// A `vendor_bill` posting (`Dr expense-or-accrual / Cr A/P`) - a
// QuickBooks Bill with account-based lines, no items (plan 67 §1-2).

import { z } from 'zod/v4'
import { baseShape, counterpartySchema, isoDateSchema, moneySchema, sumLines } from './shared'

export const BILL_OBJECT_TYPE = 'bill'

const billLineSchema = z.object({
  glAccountId: z.string().min(1),
  accountCode: z.string().nullable(),
  amountMinor: moneySchema,
  memo: z.string().optional(),
})

export const exportBillSchema = z
  .object({
    ...baseShape,
    vendor: counterpartySchema,
    dueDate: isoDateSchema.optional(),
    lines: z.array(billLineSchema).min(1),
  })
  .superRefine((value, ctx) => {
    if (value.vendor.type !== 'vendor')
      ctx.addIssue({ code: 'custom', message: "A bill's counterparty must be a vendor" })
    if (sumLines(value.lines) !== value.totalMinor)
      ctx.addIssue({ code: 'custom', message: "A bill's lines must sum to its total" })
  })

export type ExportBillPayload = z.infer<typeof exportBillSchema>
export type ExportBillLine = z.infer<typeof billLineSchema>
