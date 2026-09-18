// packages/lib/src/postings/export/payloads/payment.ts
// A customer receipt (`payment` / `deposit_application`) against an invoice or
// a fulfillment sent as Invoice - a QuickBooks Payment (plan 67 §1-2).

import { z } from 'zod/v4'
import { baseShape, counterpartySchema, glRefSchema, moneySchema } from './shared'

export const PAYMENT_OBJECT_TYPE = 'payment'

export const exportPaymentSchema = z
  .object({
    ...baseShape,
    customer: counterpartySchema,
    /** The invoice or fulfillment posting the receipt's parent order settles. */
    appliesTo: z.object({ glPostingId: z.string().min(1) }),
    amountMinor: moneySchema,
    depositTo: glRefSchema,
  })
  .superRefine((value, ctx) => {
    if (value.amountMinor !== value.totalMinor)
      ctx.addIssue({ code: 'custom', message: "A payment's amount must equal its total" })
  })

export type ExportPaymentPayload = z.infer<typeof exportPaymentSchema>
