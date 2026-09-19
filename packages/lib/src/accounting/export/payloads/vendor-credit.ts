// packages/lib/src/accounting/export/payloads/vendor-credit.ts
// A `vendor_credit` posting (`Dr A/P / Cr <each line's account>`) - a
// QuickBooks Vendor Credit with account-based lines, no items (TARGET §5).
//
// `bill.ts` with the sides flipped: the same account lines, the same vendor
// counterparty, the opposite direction.

import { z } from 'zod/v4'
import { baseShape, counterpartySchema, moneySchema, sumLines } from './shared'

export const VENDOR_CREDIT_OBJECT_TYPE = 'vendor_credit'

const vendorCreditLineSchema = z.object({
  glAccountId: z.string().min(1),
  accountCode: z.string().nullable(),
  amountMinor: moneySchema,
  memo: z.string().optional(),
})

export const exportVendorCreditSchema = z
  .object({
    ...baseShape,
    vendor: counterpartySchema,
    lines: z.array(vendorCreditLineSchema).min(1),
  })
  .superRefine((value, ctx) => {
    if (value.vendor.type !== 'vendor')
      ctx.addIssue({ code: 'custom', message: "A vendor credit's counterparty must be a vendor" })
    if (sumLines(value.lines) !== value.totalMinor)
      ctx.addIssue({ code: 'custom', message: "A vendor credit's lines must sum to its total" })
  })

export type ExportVendorCreditPayload = z.infer<typeof exportVendorCreditSchema>
export type ExportVendorCreditLine = z.infer<typeof vendorCreditLineSchema>
