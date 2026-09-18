// packages/lib/src/accounting/money/customer-money/evidence-contracts.ts
import { minorUnitExponent } from '@auxx/utils/currency'
import { z } from 'zod'

const identity = z.string().min(1)
const nullableIdentity = identity.nullable()
const sourceAccount = z
  .object({ externalAccountId: identity, environment: z.enum(['live', 'test']) })
  .strict()
const money = {
  currency: z.string().regex(/^[A-Z]{3}$/),
  currencyExponent: z.number().int().min(0).max(4),
}
/** Shared activity meanings supplied by source adapters and supported record imports. */
export const processorActivityKindSchema = z.enum([
  'charge',
  'refund',
  'fee',
  'adjustment',
  'outgoing_transfer',
  'returned_transfer',
  'unknown',
])

/** Exact processor activity; provider-specific field and status parsing belongs to its adapter. */
export const processorBalanceEvidenceSchema = z
  .object({
    id: identity,
    type: processorActivityKindSchema,
    gross: z.string(),
    fee: z.string(),
    net: z.string(),
    ...money,
    transactionDate: z.string().datetime({ offset: true }).nullable(),
    payoutId: nullableIdentity,
    sourceTransactionId: nullableIdentity,
    sourceOrderId: nullableIdentity,
    sourceId: nullableIdentity,
    sourceType: nullableIdentity,
    raw: z.unknown(),
  })
  .strict()
/** Payout header and bounded, explicitly complete membership observation. */
export const payoutEvidenceEnvelopeSchema = z
  .object({
    version: z.literal(1),
    sourceAccount,
    payout: z
      .object({
        id: identity,
        status: identity,
        amount: z.string(),
        ...money,
        issuedAt: z.string().datetime({ offset: true }).nullable(),
        issuedOn: z.string().date().nullable(),
        destinationExternalId: nullableIdentity,
        raw: z.unknown(),
      })
      .strict(),
    membership: z
      .object({
        complete: z.boolean(),
        providerReady: z.boolean(),
        reason: z.string().nullable(),
        entries: z.array(processorBalanceEvidenceSchema),
      })
      .strict(),
  })
  .strict()
/** Independent activity includes entries that have no payout yet. */
export const processorBalanceEnvelopeSchema = z
  .object({ version: z.literal(1), sourceAccount, entry: processorBalanceEvidenceSchema })
  .strict()
export type ProcessorBalanceEvidence = z.infer<typeof processorBalanceEvidenceSchema>
export type PayoutEvidenceEnvelope = z.infer<typeof payoutEvidenceEnvelopeSchema>

/** Convert signed source decimals to bigint without binary floating point. */
export function exactEvidenceMinor(amount: string, currency: string, exponent: number): bigint {
  if (
    !Intl.supportedValuesOf('currency').includes(currency) ||
    minorUnitExponent(currency) !== exponent
  )
    throw new Error('Currency exponent does not match the supported currency catalog')
  if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(amount)) throw new Error('Invalid source amount')
  const negative = amount.startsWith('-')
  const [whole, fraction = ''] = (negative ? amount.slice(1) : amount).split('.')
  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent)))
    throw new Error('Source amount exceeds currency precision')
  const absolute =
    BigInt(whole!) * 10n ** BigInt(exponent) +
    BigInt(fraction.slice(0, exponent).padEnd(exponent, '0') || '0')
  const minor = negative ? -absolute : absolute
  if (minor < -9223372036854775808n || minor > 9223372036854775807n)
    throw new Error('Source amount exceeds bigint storage capacity')
  return minor
}

/** Payout movement rows are retained but cannot count toward their own settlement. */
export function isOutgoingPayoutEntry(type: string): boolean {
  return type === 'outgoing_transfer'
}

/** Assess source coverage separately from provider readiness and future accounting acceptance. */
export function assessPayoutMembership(envelope: PayoutEvidenceEnvelope) {
  const { payout, membership } = envelope
  const ids = new Set<string>()
  const reasons: string[] = []
  let total = 0n
  let comparable = true
  for (const entry of membership.entries) {
    if (ids.has(entry.id)) {
      reasons.push('Duplicate processor entry identity in payout membership')
      continue
    }
    ids.add(entry.id)
    let net: bigint
    try {
      net = exactEvidenceMinor(entry.net, entry.currency, entry.currencyExponent)
      const gross = exactEvidenceMinor(entry.gross, entry.currency, entry.currencyExponent)
      const fee = exactEvidenceMinor(entry.fee, entry.currency, entry.currencyExponent)
      if (gross - fee !== net)
        reasons.push('Processor entry gross less fees differs from its reported net')
    } catch {
      comparable = false
      reasons.push(`Processor entry ${entry.id} has invalid or unsupported money evidence`)
      continue
    }
    if (entry.payoutId !== payout.id)
      reasons.push('Processor entry belongs to another payout or is unassigned')
    if (entry.currency !== payout.currency || entry.currencyExponent !== payout.currencyExponent) {
      comparable = false
      reasons.push('Processor entry currency differs from the payout settlement currency')
    }
    if (entry.type === 'unknown' || entry.type === 'returned_transfer') {
      comparable = false
      reasons.push(`Processor entry ${entry.id} requires separate activity assessment`)
    } else if (!isOutgoingPayoutEntry(entry.type)) total += net
  }
  if (!membership.complete)
    reasons.push(membership.reason || 'Payout membership has not completed all pages')
  if (total < -9223372036854775808n || total > 9223372036854775807n) {
    comparable = false
    reasons.push('Payout total exceeds bigint storage capacity')
  }
  const difference = comparable
    ? exactEvidenceMinor(payout.amount, payout.currency, payout.currencyExponent) - total
    : null
  const differenceInRange =
    difference === null ||
    (difference >= -9223372036854775808n && difference <= 9223372036854775807n)
  if (!differenceInRange) reasons.push('Payout difference exceeds bigint storage capacity')
  return {
    state:
      !comparable || !differenceInRange
        ? ('unsupported' as const)
        : reasons.length
          ? ('incomplete' as const)
          : ('complete' as const),
    reason: reasons.join('; ') || membership.reason,
    constituentNetMinor: comparable ? total : null,
    differenceMinor: differenceInRange ? difference : null,
  }
}
