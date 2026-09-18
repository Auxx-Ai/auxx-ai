// packages/lib/src/postings/export/payloads/deposit.ts
// A `payout` (Dr bank, Dr fees, Cr clearing) or `bank_deposit` (Dr bank, Cr
// undeposited funds) posting - a QuickBooks Deposit, the fee as a negative
// line (plan 67 §1-2, §7 D4).

import { z } from 'zod/v4'
import { baseShape, glRefSchema, signedMoneySchema } from './shared'

export const DEPOSIT_OBJECT_TYPE = 'deposit'

const depositLineSchema = z.object({
  fromAccount: glRefSchema,
  /** Signed: a payout's fee line is negative. */
  amountMinor: signedMoneySchema,
  memo: z.string().optional(),
})

export const exportDepositSchema = z
  .object({
    ...baseShape,
    depositTo: glRefSchema,
    lines: z.array(depositLineSchema).min(1),
  })
  .superRefine((value, ctx) => {
    const sum = value.lines.reduce((total, line) => total + line.amountMinor, 0)
    if (sum !== value.totalMinor)
      ctx.addIssue({ code: 'custom', message: "A deposit's signed lines must sum to its total" })
    if (value.lines.filter((line) => line.amountMinor < 0).length > 1)
      ctx.addIssue({
        code: 'custom',
        message: 'A deposit may carry at most one negative (fee) line',
      })
  })

export type ExportDepositPayload = z.infer<typeof exportDepositSchema>
export type ExportDepositLine = z.infer<typeof depositLineSchema>
