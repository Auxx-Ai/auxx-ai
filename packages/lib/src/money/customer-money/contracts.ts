// packages/lib/src/money/customer-money/contracts.ts
import { minorUnitExponent } from '@auxx/utils/currency'
import { z } from 'zod'

/** Source data at the actual transaction grain; no order-total payment inference. */
export const shopifyMoneyObservationSchema = z
  .object({
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
  })
  .strict()

/** Versioned wire contract emitted by the installed Shopify connector. */
export const shopifyMoneyEnvelopeSchema = z
  .object({
    version: z.literal(1),
    complete: z.boolean(),
    transactions: z.array(z.unknown()).max(250),
  })
  .strict()

export type ShopifyMoneyObservation = z.infer<typeof shopifyMoneyObservationSchema>

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

/** Only confirmed captures/sales/refunds create actual movements. */
export function confirmedShopifyMovement(observation: ShopifyMoneyObservation) {
  if (observation.status.toUpperCase() !== 'SUCCESS')
    throw new Error('Transaction success is not confirmed')
  const kind = observation.kind.toUpperCase()
  if (!['SALE', 'CAPTURE', 'REFUND'].includes(kind))
    throw new Error('Transaction is not an actual receipt or refund')
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
    purpose: kind === 'REFUND' ? ('customer_refund' as const) : ('customer_receipt' as const),
    occurredAt,
  }
}

/** Stable Shopify store identity from the same connection variable the installed adapter uses. */
export function shopifySourceDomain(metadata: Record<string, unknown>): string {
  const variables = metadata.connectionVariables as Record<string, unknown> | undefined
  const shop = variables?.shop
  if (typeof shop !== 'string' || !shop.trim())
    throw new Error('Shopify source store identity is missing')
  const domain = shop.includes('.') ? shop.toLowerCase() : `${shop.toLowerCase()}.myshopify.com`
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain))
    throw new Error('Shopify source store identity is invalid')
  return domain
}
