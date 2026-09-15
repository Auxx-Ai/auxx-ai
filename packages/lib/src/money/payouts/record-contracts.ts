// packages/lib/src/money/payouts/record-contracts.ts
import { z } from 'zod'

const identity = z.string().min(1)
/** Stable merchant identity; importing application identity is separate provenance. */
export const financialSourceAccountSchema = z
  .object({
    providerKey: identity,
    externalAccountId: identity,
    environment: z.enum(['live', 'test']),
  })
  .strict()
export const financialSourceReferenceSchema = z
  .object({
    sourceAccount: financialSourceAccountSchema,
    objectType: identity,
    externalId: identity,
    componentKey: z.string(),
  })
  .strict()
const acquisition = z
  .object({ id: identity, startedAt: z.string().datetime({ offset: true }) })
  .strict()
const currency = {
  currency: z.string().regex(/^[A-Z]{3}$/),
  currencyExponent: z.number().int().min(0).max(4),
}
const nullableIdentity = identity.nullable()
/** Provider-normalized processor observation; money remains exact decimal text on the wire. */
export const processorRecordEntrySchema = z
  .object({
    id: identity,
    type: z.enum([
      'charge',
      'refund',
      'fee',
      'adjustment',
      'outgoing_transfer',
      'returned_transfer',
      'unknown',
    ]),
    providerType: identity,
    gross: z.string(),
    fee: z.string(),
    net: z.string(),
    ...currency,
    transactionDate: z.string().datetime({ offset: true }).nullable(),
    payoutId: nullableIdentity,
    sourceTransactionId: nullableIdentity,
    sourceOrderId: nullableIdentity,
    sourceId: nullableIdentity,
    sourceType: nullableIdentity,
    sourceReference: financialSourceReferenceSchema.nullable().optional(),
    raw: z.unknown(),
  })
  .strict()
export const payoutRecordHeaderSchema = z
  .object({
    id: identity,
    status: identity,
    amount: z.string(),
    ...currency,
    issuedAt: z.string().datetime({ offset: true }).nullable(),
    issuedOn: z.string().date().nullable(),
    destinationExternalId: nullableIdentity,
    raw: z.unknown(),
  })
  .strict()
const membershipPage = z
  .object({
    id: identity,
    index: z.number().int().nonnegative(),
    requestCursor: z.string().nullable(),
    nextCursor: z.string().nullable(),
    terminal: z.boolean(),
  })
  .strict()
/** One bounded source membership page, persisted before its intake cursor advances. */
export const payoutRecordEvidenceSchema = z
  .object({
    version: z.literal(2),
    externalId: identity.optional(),
    sourceAccount: financialSourceAccountSchema,
    acquisition,
    payout: payoutRecordHeaderSchema.nullable(),
    raw: z.unknown(),
    rejectionReason: z.string().nullable(),
    membership: z
      .object({
        providerReady: z.boolean(),
        complete: z.boolean(),
        reason: z.string().nullable(),
        page: membershipPage.nullable(),
        entries: z.array(processorRecordEntrySchema).max(250),
        rejections: z.array(
          z.object({ index: z.number().int().nonnegative(), raw: z.unknown(), reason: identity })
        ),
        rawRows: z.array(z.unknown()).max(250),
      })
      .strict(),
  })
  .strict()
/** One processor source row, including a retained rejection with no fabricated amount. */
export const processorRecordEvidenceSchema = z
  .object({
    version: z.literal(2),
    externalId: identity.optional(),
    sourceAccount: financialSourceAccountSchema,
    acquisition,
    page: z
      .object({
        id: identity,
        index: z.number().int().nonnegative(),
        rowIndex: z.number().int().nonnegative(),
      })
      .strict(),
    entry: processorRecordEntrySchema.nullable(),
    raw: z.unknown(),
    rejectionReason: z.string().nullable(),
  })
  .strict()
export type PayoutRecordEvidence = z.infer<typeof payoutRecordEvidenceSchema>
export type ProcessorRecordEvidence = z.infer<typeof processorRecordEvidenceSchema>
export type FinancialRecordEvidence = PayoutRecordEvidence | ProcessorRecordEvidence
export type FinancialRecordType = 'payout' | 'processor_balance_entry'
