// packages/lib/src/postings/export/payloads/credit-memo.ts
// A `credit_memo` posting issued against a customer - a QuickBooks CreditMemo
// (plan 67 §1-2).

import { z } from 'zod/v4'
import { baseShape, counterpartySchema, itemLineSchema, sumLines } from './shared'

export const CREDIT_MEMO_OBJECT_TYPE = 'credit_memo'

export const exportCreditMemoSchema = z
  .object({
    ...baseShape,
    customer: counterpartySchema,
    lines: z.array(itemLineSchema).min(1),
  })
  .superRefine((value, ctx) => {
    if (sumLines(value.lines) !== value.totalMinor)
      ctx.addIssue({ code: 'custom', message: "A credit memo's lines must sum to its total" })
  })

export type ExportCreditMemoPayload = z.infer<typeof exportCreditMemoSchema>
