// packages/lib/src/money/payouts/match-entries.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import type { z } from 'zod'
import { financialSourceReferenceSchema } from './record-contracts'

/** Evidence needed to link activity to an already recorded customer movement. */
export interface MatchableProcessorEntry {
  id: string
  sourceAccountId: string
  sourceReference: unknown
  type: string
  grossMinor: bigint
  currency: string
  currencyExponent: number
}

function referenceKey(
  reference: Omit<z.infer<typeof financialSourceReferenceSchema>, 'sourceAccount'> & {
    sourceAccount: { providerKey: string; externalAccountId: string; environment: string }
  }
): string {
  return JSON.stringify([
    reference.sourceAccount.providerKey,
    reference.sourceAccount.externalAccountId,
    reference.sourceAccount.environment,
    reference.objectType,
    reference.externalId,
    reference.componentKey,
  ])
}

/** Match scoped source identities in bounded sets; amounts validate identity, never establish it. */
export async function matchProcessorEntries(
  db: Database | Transaction,
  organizationId: string,
  entries: MatchableProcessorEntry[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const eligible = entries.flatMap((entry) => {
    if (entry.type !== 'charge' && entry.type !== 'refund') return []
    const parsed = financialSourceReferenceSchema.safeParse(entry.sourceReference)
    return parsed.success ? [{ entry, reference: parsed.data }] : []
  })
  for (let offset = 0; offset < eligible.length; offset += 200) {
    const chunk = eligible.slice(offset, offset + 200)
    const rows = await db
      .select({
        object: schema.FinancialSourceObject,
        account: schema.FinancialSourceAccount,
        money: schema.MoneyTransaction,
        processorAccountId: schema.PaymentRoute.processorAccountId,
      })
      .from(schema.FinancialSourceObject)
      .innerJoin(
        schema.FinancialSourceAccount,
        and(
          eq(
            schema.FinancialSourceAccount.organizationId,
            schema.FinancialSourceObject.organizationId
          ),
          eq(schema.FinancialSourceAccount.id, schema.FinancialSourceObject.sourceAccountId)
        )
      )
      .innerJoin(
        schema.MoneySourceLink,
        and(
          eq(schema.MoneySourceLink.organizationId, schema.FinancialSourceObject.organizationId),
          eq(schema.MoneySourceLink.sourceObjectId, schema.FinancialSourceObject.id)
        )
      )
      .innerJoin(
        schema.MoneyTransaction,
        and(
          eq(schema.MoneyTransaction.organizationId, schema.MoneySourceLink.organizationId),
          eq(schema.MoneyTransaction.id, schema.MoneySourceLink.moneyTransactionId)
        )
      )
      .innerJoin(
        schema.PaymentRoute,
        and(
          eq(schema.PaymentRoute.organizationId, schema.MoneyTransaction.organizationId),
          eq(schema.PaymentRoute.id, schema.MoneyTransaction.paymentRouteId)
        )
      )
      .where(
        and(
          eq(schema.FinancialSourceObject.organizationId, organizationId),
          inArray(schema.FinancialSourceObject.externalId, [
            ...new Set(chunk.map(({ reference }) => reference.externalId)),
          ]),
          inArray(schema.PaymentRoute.processorAccountId, [
            ...new Set(chunk.map(({ entry }) => entry.sourceAccountId)),
          ])
        )
      )
    const byReference = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = referenceKey({
        sourceAccount: row.account,
        objectType: row.object.objectType,
        externalId: row.object.externalId,
        componentKey: row.object.componentKey,
      })
      const list = byReference.get(key) ?? []
      list.push(row)
      byReference.set(key, list)
    }
    for (const { entry, reference } of chunk) {
      const candidates = byReference.get(referenceKey(reference)) ?? []
      const matches = candidates.filter(
        ({ money, processorAccountId }) =>
          processorAccountId === entry.sourceAccountId &&
          money.currency === entry.currency &&
          money.currencyExponent === entry.currencyExponent &&
          money.amountMinor === (entry.grossMinor < 0n ? -entry.grossMinor : entry.grossMinor) &&
          money.purpose === (entry.type === 'refund' ? 'customer_refund' : 'customer_receipt')
      )
      const moneyIds = [...new Set(matches.map(({ money }) => money.id))]
      if (moneyIds.length === 1) result.set(entry.id, moneyIds[0]!)
    }
  }
  return result
}
