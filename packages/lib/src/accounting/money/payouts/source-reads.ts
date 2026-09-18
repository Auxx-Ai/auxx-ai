// packages/lib/src/accounting/money/payouts/source-reads.ts
import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { listPaymentGateways } from '../../rails/reads'
import { exactEvidenceMinor } from '../customer-money/evidence-contracts'
import type { PayoutRecord } from './types'

/** Ordinary source fields needed by the settlement list. */
export const PAYOUT_SOURCE_ATTRIBUTES = [
  'payout_source_source_key',
  'payout_source_provider_key',
  'payout_source_account_id',
  'payout_source_environment',
  'payout_source_external_id',
  'payout_source_amount',
  'payout_source_currency',
  'payout_source_currency_exponent',
  'payout_source_status',
  'payout_source_issued_at',
  'payout_source_issued_on',
  'payout_source_rejection_reason',
] as const

/** Reported payout facts and current settlement configuration, not a posted settlement. */
export interface PayoutSourceSummary {
  amountMinor: string | null
  currency: string | null
  currencyExponent: number | null
  status: string | null
  issuedOn: string | null
  provider: string | null
  externalAccountId: string | null
  gatewayId: string | null
  gatewayName: string | null
  routingIssue: string | null
  amountIssue: string | null
}

/** Read exact mapped amounts and match only the same provider, merchant, environment and currency. */
export async function loadPayoutSourceSummaries(
  db: Database,
  organizationId: string,
  records: Pick<PayoutRecord, 'payoutId' | 'reportedFields'>[]
): Promise<Map<string, PayoutSourceSummary>> {
  const sourceRecords = records.filter((record) =>
    Object.values(record.reportedFields ?? {}).some((value) => value !== null)
  )
  const summaries = new Map<string, PayoutSourceSummary>()
  if (!sourceRecords.length) return summaries
  const externalIds = sourceRecords.flatMap((record) => {
    const id = record.reportedFields?.payout_source_account_id
    return typeof id === 'string' ? [id] : []
  })
  const accounts = externalIds.length
    ? await db
        .select()
        .from(schema.FinancialSourceAccount)
        .where(
          and(
            eq(schema.FinancialSourceAccount.organizationId, organizationId),
            inArray(schema.FinancialSourceAccount.externalAccountId, externalIds),
            isNull(schema.FinancialSourceAccount.archivedAt)
          )
        )
    : []
  const gateways = await listPaymentGateways(db, organizationId)
  if (gateways.isErr()) throw gateways.error
  for (const record of sourceRecords) {
    const fields = record.reportedFields!
    const text = (key: string) => (typeof fields[key] === 'string' ? (fields[key] as string) : null)
    const currency = text('payout_source_currency')
    const exponent = fields.payout_source_currency_exponent
    const currencyExponent = typeof exponent === 'number' ? exponent : null
    let amountMinor: string | null = null
    let amountIssue = text('payout_source_rejection_reason')
    try {
      const amount = text('payout_source_amount')
      if (amount === null || !currency || currencyExponent === null)
        throw new Error('Incomplete amount')
      amountMinor = exactEvidenceMinor(amount, currency, currencyExponent).toString()
    } catch {
      amountIssue ??= 'The payout amount or currency is missing or invalid. Re-sync this payout.'
    }
    const provider = text('payout_source_provider_key')
    const externalAccountId = text('payout_source_account_id')
    const environment = text('payout_source_environment')
    const account = accounts.find(
      (item) =>
        item.providerKey === provider &&
        item.externalAccountId === externalAccountId &&
        item.environment === environment
    )
    // 58 §4.2/§5.5: the link is `FinancialSourceAccount.paymentGatewayId` itself, a single
    // pointer - not a text match on a retired `processorAccountId`/`settlementCurrency` pair,
    // which could never disagree in two directions (`gateways` no longer carries either).
    const gateway =
      account && environment === 'live' && account.paymentGatewayId
        ? (gateways.value.find((item) => item.id === account.paymentGatewayId) ?? null)
        : null
    summaries.set(record.payoutId, {
      amountMinor,
      currency,
      currencyExponent,
      status: text('payout_source_status'),
      issuedOn: text('payout_source_issued_on') ?? text('payout_source_issued_at'),
      provider,
      externalAccountId,
      gatewayId: gateway?.id ?? null,
      gatewayName: gateway?.name ?? null,
      routingIssue: gateway
        ? null
        : 'Link this merchant account to a payment gateway on Accounting > Settings > Payment gateways.',
      amountIssue,
    })
  }
  return summaries
}
