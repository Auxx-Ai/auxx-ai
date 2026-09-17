// packages/lib/src/postings/delivery-proof.ts
import { z } from 'zod/v4'
import { canonicalAccountingJson } from './basis-hash'

const party = z.object({ type: z.enum(['Customer', 'Vendor', 'Employee']), id: z.string().min(1) })
export const preparedJournalSchema = z
  .object({
    lines: z
      .array(
        z.object({
          amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          postingType: z.enum(['Debit', 'Credit']),
          accountId: z.string().min(1),
          description: z.string().optional(),
          entity: party.optional(),
        })
      )
      .min(2),
    txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    docNumber: z.string().min(1).max(21),
    privateNote: z.string().max(4000),
    requestId: z.string().min(1).max(50),
    currency: z.literal('USD'),
  })
  .superRefine((value, ctx) => {
    let debit = 0n,
      credit = 0n
    for (const line of value.lines) {
      if (!Number.isSafeInteger(line.amountMinor) || line.amountMinor <= 0) return
      if (Math.round((line.amountMinor / 100) * 100) !== line.amountMinor) {
        ctx.addIssue({
          code: 'custom',
          message: 'Journal amount cannot round-trip through the provider decimal wire format',
        })
      }
      if (line.postingType === 'Debit') debit += BigInt(line.amountMinor)
      else credit += BigInt(line.amountMinor)
    }
    if (debit !== credit || debit > BigInt(Number.MAX_SAFE_INTEGER)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Journal must balance exactly within supported totals',
      })
    }
  })
const remoteJournalSchema = z.object({
  journalEntryId: z.string().min(1),
  docNumber: z.string(),
  txnDate: z.string(),
  currency: z.string(),
  syncToken: z.string(),
  privateNote: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        postingType: z.enum(['Debit', 'Credit']),
        accountId: z.string().min(1),
        entityType: z.enum(['Customer', 'Vendor', 'Employee']).nullable(),
        entityId: z.string().nullable(),
      })
    )
    .min(2),
})
export type PreparedJournal = z.infer<typeof preparedJournalSchema>
export type VerifiedJournal = z.infer<typeof remoteJournalSchema>

/**
 * Match the full accounting basis; a document-number match alone is never
 * ownership proof.
 *
 * 🔌 `toNeutralParty` is the adapter's translation of its own journal-line party
 * vocabulary into the platform's (decision D14b). It is REQUIRED rather than
 * defaulted to identity: the delivery tables stopped speaking any provider's
 * object names, so a comparison that silently passed a provider spelling
 * through would be comparing two vocabularies and calling it a match. The one
 * caller passes `money/quickbooks/object-types.ts`'s map.
 */
export function verifyDeliveredJournal(input: {
  prepared: unknown
  remote: unknown
  intendedCompanyId: string
  actualCompanyId: string
  toNeutralParty: (providerPartyType: string) => string
}): VerifiedJournal {
  const expected = preparedJournalSchema.parse(input.prepared)
  const actual = remoteJournalSchema.parse(input.remote)
  if (
    input.actualCompanyId !== input.intendedCompanyId ||
    actual.docNumber !== expected.docNumber ||
    actual.txnDate !== expected.txnDate ||
    actual.currency !== expected.currency ||
    actual.privateNote !== expected.privateNote
  ) {
    throw new Error(
      'QuickBooks journal identity, date, currency or authorship conflicts with the saved request'
    )
  }
  const lines = (
    rows: Array<{
      amountMinor: number
      postingType: string
      accountId: string
      entityType?: string | null
      entityId?: string | null
      entity?: { type: string; id: string }
    }>
  ) =>
    rows
      .map((l) => {
        const partyType = l.entity?.type ?? l.entityType ?? null
        return canonicalAccountingJson({
          amount: String(l.amountMinor),
          direction: l.postingType,
          accountId: l.accountId,
          partyType: partyType === null ? null : input.toNeutralParty(partyType),
          partyId: l.entity?.id ?? l.entityId ?? null,
        })
      })
      .sort()
  if (
    canonicalAccountingJson(lines(expected.lines)) !== canonicalAccountingJson(lines(actual.lines))
  ) {
    throw new Error(
      'QuickBooks journal accounts, amounts or counterparties conflict with the saved request'
    )
  }
  return actual
}

/** Exact deterministic QuickBooks wire body used by the pinned app tool contract. */
export function quickbooksJournalWirePayload(value: unknown): Record<string, unknown> {
  const input = preparedJournalSchema.parse(value)
  return {
    Line: input.lines.map((line) => ({
      DetailType: 'JournalEntryLineDetail',
      Amount: line.amountMinor / 100,
      ...(line.description ? { Description: line.description } : {}),
      JournalEntryLineDetail: {
        PostingType: line.postingType,
        AccountRef: { value: line.accountId },
        ...(line.entity
          ? { Entity: { Type: line.entity.type, EntityRef: { value: line.entity.id } } }
          : {}),
      },
    })),
    TxnDate: input.txnDate,
    DocNumber: input.docNumber,
    PrivateNote: input.privateNote,
    CurrencyRef: { value: input.currency },
  }
}
