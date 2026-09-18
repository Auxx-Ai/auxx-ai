// packages/lib/src/accounting/money/customer-money/contracts.ts
import { minorUnitExponent } from '@auxx/utils/currency'
import { z } from 'zod'

const transactionIdentityFields = {
  id: z.string().min(1),
  kind: z.string().min(1),
  status: z.string().min(1),
  amount: z.string(),
  currency: z.string(),
  processedAt: z.string().nullable(),
  gateway: z.string().nullable(),
  settlementCurrency: z.string().nullable(),
  parentTransactionId: z.string().nullable(),
  creditMemoExternalId: z.string().nullable(),
  paymentId: z.string().nullable(),
  test: z.boolean(),
}

/** Exact decimal-to-minor conversion; preserve foreign currency while its GL remains blocked. */
export function exactSourceMoney(amount: string, currency: string) {
  if (!Intl.supportedValuesOf('currency').includes(currency))
    throw new Error('Unsupported source currency')
  const exponent = minorUnitExponent(currency)
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(amount)) throw new Error('Invalid source amount')
  const [whole, fraction = ''] = amount.split('.')
  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent)))
    throw new Error('Source amount exceeds currency precision')
  const minor =
    BigInt(whole!) * 10n ** BigInt(exponent) +
    BigInt(fraction.slice(0, exponent).padEnd(exponent, '0') || '0')
  if (minor <= 0n || minor > 9223372036854775807n)
    throw new Error('Source amount is outside supported positive money range')
  return { amountMinor: minor, currency, currencyExponent: exponent }
}

/** Provider-independent transaction facts persisted by ordinary order record writes. */
export const customerMoneyObservationSchema = z
  .object({
    ...transactionIdentityFields,
    version: z.literal(2),
    kind: z.enum(['receipt', 'refund', 'authorization', 'void', 'unknown']),
    status: z.enum(['confirmed', 'failed', 'pending']),
    creditMemoInstanceId: z.string().min(1).nullable().optional(),
    raw: z.unknown().optional(),
  })
  .strict()

/** Shared record evidence; absent source revision cannot overwrite a conflicting prior observation. */
export const orderPaymentEvidenceSchema = z
  .object({
    version: z.literal(2),
    sourceAccount: z
      .object({
        providerKey: z.string().min(1),
        externalAccountId: z.string().min(1),
        environment: z.enum(['live', 'test']),
      })
      .strict(),
    orderExternalId: z.string().min(1),
    sourceUpdatedAt: z.string().datetime({ offset: true }).nullable(),
    complete: z.boolean(),
    transactions: z.array(z.unknown()).max(250),
  })
  .strict()

/** Resolve exact money only after a normalized source confirms an actual receipt or refund. */
export function confirmedCustomerMovement(
  observation: z.infer<typeof customerMoneyObservationSchema>
) {
  if (observation.status !== 'confirmed' || !['receipt', 'refund'].includes(observation.kind))
    throw new Error('Transaction is not a confirmed receipt or refund')
  if (
    !observation.processedAt ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(observation.processedAt)
  )
    throw new Error('Transaction occurrence instant is missing')
  const occurredAt = new Date(observation.processedAt)
  if (!Number.isFinite(occurredAt.getTime()))
    throw new Error('Transaction occurrence instant is invalid')
  return {
    ...exactSourceMoney(observation.amount, observation.currency),
    purpose:
      observation.kind === 'refund' ? ('customer_refund' as const) : ('customer_receipt' as const),
    occurredAt,
  }
}
