// packages/lib/src/accounting/export/payloads/journal.ts
// The provider-NEUTRAL journal an export batch freezes. Every object type was a
// journal in step 3; native objects (the rest of this directory) arrive in step
// 4 (MIGRATION step 4). Moved unchanged from `../payload.ts`.

import { z } from 'zod/v4'
import { accountingBasisHash } from '../../../postings/basis-hash'

/** The only object type step 3 built. A plain string, not a DB enum. */
export const JOURNAL_OBJECT_TYPE = 'journal'

const counterparty = z.object({
  type: z.enum(['customer', 'vendor']),
  id: z.string().min(1),
})

/**
 * One line, in OUR account vocabulary.
 *
 * 🛑 `glAccountId` and `accountCode`, never a provider account id (decision P2).
 * The adapter resolves them at send time, so a batch built before a mapping
 * changed sends against the mapping that is live when it goes.
 */
const exportJournalLineSchema = z.object({
  glAccountId: z.string().min(1),
  accountCode: z.string().nullable(),
  direction: z.enum(['debit', 'credit']),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sortOrder: z.number().int(),
  memo: z.string().optional(),
  counterparty: counterparty.optional(),
})

export const exportJournalSchema = z
  .object({
    v: z.literal(1),
    txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    docNumber: z.string().min(1).max(21),
    /** The forensic stamp a human greps the provider's register for. */
    privateNote: z.string().max(4000),
    currency: z.literal('USD'),
    totalMinor: z.number().int().nonnegative(),
    lines: z.array(exportJournalLineSchema).min(2),
  })
  .superRefine((value, ctx) => {
    let debit = 0
    let credit = 0
    for (const line of value.lines) {
      if (line.direction === 'debit') debit += line.amountMinor
      else credit += line.amountMinor
    }
    if (debit !== credit)
      ctx.addIssue({ code: 'custom', message: 'An export journal must balance exactly' })
    if (debit !== value.totalMinor)
      ctx.addIssue({ code: 'custom', message: 'An export journal total must equal each side' })
  })

export type ExportJournalPayload = z.infer<typeof exportJournalSchema>
export type ExportJournalLine = z.infer<typeof exportJournalLineSchema>

/** Parse an opaque stored payload back into the journal shape. Throws on drift. */
export function parseExportJournal(payload: unknown): ExportJournalPayload {
  return exportJournalSchema.parse(payload)
}

/** The frozen payload's identity. Canonical, so key order cannot change it. */
export function hashExportPayload(payload: unknown): string {
  return accountingBasisHash(payload)
}
