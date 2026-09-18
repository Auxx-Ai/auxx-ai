// packages/lib/src/accounting/export/payloads/shared.ts
// Pieces every native payload shares (plan 67 §2, decision P2): `glAccountId` +
// `accountCode` never a provider id, integer minor units, a 21-char doc number,
// the `auxx:gl:…` stamp on `privateNote`.

import { z } from 'zod/v4'

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const docNumberSchema = z.string().min(1).max(21)
export const privateNoteSchema = z.string().max(4000)
export const moneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** A deposit's fee line is the one signed exception (§1's payout row). */
export const signedMoneySchema = z.number().int().max(Number.MAX_SAFE_INTEGER)

export const counterpartySchema = z.object({
  type: z.enum(['customer', 'vendor']),
  id: z.string().min(1),
})

/** `glAccountId` + `accountCode`, never a provider account id (decision P2). */
export const glRefSchema = z.object({
  glAccountId: z.string().min(1),
  accountCode: z.string().nullable(),
})

/** One revenue-side line: a SalesItemLineDetail on the generic item of `glAccountId`. */
export const itemLineSchema = z.object({
  glAccountId: z.string().min(1),
  accountCode: z.string().nullable(),
  amountMinor: moneySchema,
  sortOrder: z.number().int(),
  memo: z.string().optional(),
  /** `NON` on the sales-tax line, absent otherwise (§7 D2). */
  taxCode: z.enum(['NON']).optional(),
})

/** Every native payload's shared envelope, spread into each object's own shape. */
export const baseShape = {
  v: z.literal(1),
  txnDate: isoDateSchema,
  docNumber: docNumberSchema,
  privateNote: privateNoteSchema,
  currency: z.literal('USD'),
  totalMinor: moneySchema,
}

/** Sum of `amountMinor` across a payload's item/expense lines. */
export function sumLines(lines: ReadonlyArray<{ amountMinor: number }>): number {
  return lines.reduce((total, line) => total + line.amountMinor, 0)
}
