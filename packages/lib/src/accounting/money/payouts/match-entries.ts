// packages/lib/src/accounting/money/payouts/match-entries.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import type { z } from 'zod'
import { financialSourceReferenceSchema } from '../customer-money/record-contracts'
import { readSourceAccounts } from '../customer-money/source-reads'
import type { MatchReason } from './match-reasons'

/**
 * The processor row types the matcher links to a movement. `ProcessorBalanceEntry.type` is
 * free text; a `dispute` (a chargeback) is money leaving, so it matches a customer refund.
 */
export const MATCHABLE_ENTRY_TYPES: readonly string[] = ['charge', 'refund', 'dispute']

/** The movement purpose a matchable row's money has. */
export function movementPurposeForEntryType(type: string): 'customer_receipt' | 'customer_refund' {
  return type === 'refund' || type === 'dispute' ? 'customer_refund' : 'customer_receipt'
}

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

/**
 * Every `payment_gateway` a set of `FinancialSourceAccount` ids settles for.
 *
 * The disambiguator a receipt's own reference cannot carry by itself: two
 * gateways can report the identical order reference (a shared reference
 * misfires this exact way), and only agreement on the RAIL says which one
 * actually settled it. A retired `PaymentRoute` row used to carry this on
 * the `MoneyTransaction` side; it is retired (task 58 D5) and never had a live
 * row to replace (§2.3 - zero processor `PaymentRoute` writes in production).
 * `FinancialSourceAccount.paymentGatewayId` (D3) is the one link left.
 */
async function readPaymentGatewayByAccount(
  db: Database | Transaction,
  organizationId: string,
  accountIds: readonly string[]
): Promise<Map<string, string>> {
  const accounts = await readSourceAccounts(db, organizationId, accountIds)
  const result = new Map<string, string>()
  for (const [id, row] of accounts) {
    if (row.paymentGatewayId) result.set(id, row.paymentGatewayId)
  }
  return result
}

/**
 * Why one entry is not matched, and the single receipt that nearly passed.
 *
 * A suggestion is only ever ONE receipt (§13 Q9): two candidates failing
 * different checks are `ambiguous`, never a suggestion nobody can trust.
 */
export type MatchRefusal =
  | { reason: 'no_receipt' | 'no_rail' | 'no_reference' | 'ambiguous' }
  | { reason: 'amount_differs' | 'rail_differs'; candidateMoneyTransactionId: string }

/** What {@link assessProcessorEntries} decided for a set of entries, keyed by entry id. */
export interface ProcessorMatchOutcome {
  /** Exact matches — every check passed and exactly one receipt survived. */
  matches: Map<string, string>
  /** Everything else that was eligible to match at all. */
  refusals: Map<string, MatchRefusal>
}

/** The reason code a refusal stores. Kept as one mapping so callers never re-derive it. */
export const refusalReason = (refusal: MatchRefusal): MatchReason => refusal.reason

/** Match scoped source identities in bounded sets; amounts validate identity, never establish it. */
export async function matchProcessorEntries(
  db: Database | Transaction,
  organizationId: string,
  entries: MatchableProcessorEntry[]
): Promise<Map<string, string>> {
  return (await assessProcessorEntries(db, organizationId, entries)).matches
}

/**
 * The exact matches, plus a reason for every eligible entry that has none.
 *
 * Same walk and the same checks as before; it only keeps the near miss it was
 * already computing in order to reject it (§10.4).
 */
export async function assessProcessorEntries(
  db: Database | Transaction,
  organizationId: string,
  entries: MatchableProcessorEntry[]
): Promise<ProcessorMatchOutcome> {
  const result = new Map<string, string>()
  const refusals = new Map<string, MatchRefusal>()
  const eligible = entries.flatMap((entry) => {
    if (!MATCHABLE_ENTRY_TYPES.includes(entry.type)) return []
    const parsed = financialSourceReferenceSchema.safeParse(entry.sourceReference)
    if (!parsed.success) {
      refusals.set(entry.id, { reason: 'no_reference' })
      return []
    }
    return [{ entry, reference: parsed.data }]
  })
  if (eligible.length === 0) return { matches: result, refusals }

  const gatewayByAccount = await readPaymentGatewayByAccount(
    db,
    organizationId,
    eligible.map(({ entry }) => entry.sourceAccountId)
  )

  for (let offset = 0; offset < eligible.length; offset += 200) {
    const chunk = eligible.slice(offset, offset + 200)
    const rows = await db
      .select({
        object: schema.FinancialSourceObject,
        account: schema.FinancialSourceAccount,
        money: schema.MoneyTransaction,
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
      .where(
        and(
          eq(schema.FinancialSourceObject.organizationId, organizationId),
          inArray(schema.FinancialSourceObject.externalId, [
            ...new Set(chunk.map(({ reference }) => reference.externalId)),
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
      // No rail on the entry's own account is a refusal, not a wildcard - an
      // unlinked merchant account must not match every rail's receipts.
      const gatewayId = gatewayByAccount.get(entry.sourceAccountId)
      if (!gatewayId) {
        refusals.set(entry.id, { reason: 'no_rail' })
        continue
      }
      // Currency and purpose are part of the identity, not a check a person can
      // vouch for; a candidate failing either is not this item's receipt at all.
      const candidates = (byReference.get(referenceKey(reference)) ?? []).filter(
        ({ money }) =>
          money.currency === entry.currency &&
          money.currencyExponent === entry.currencyExponent &&
          money.purpose === movementPurposeForEntryType(entry.type)
      )
      if (!candidates.length) {
        refusals.set(entry.id, { reason: 'no_receipt' })
        continue
      }
      const graded = candidates.map(({ money, account }) => ({
        money,
        // The receipt's own gateway first: a store account takes payments on several.
        railOk: (money.paymentGatewayId ?? account.paymentGatewayId) === gatewayId,
        amountOk:
          money.amountMinor === (entry.grossMinor < 0n ? -entry.grossMinor : entry.grossMinor),
      }))
      const moneyIds = [
        ...new Set(graded.filter((c) => c.railOk && c.amountOk).map((c) => c.money.id)),
      ]
      if (moneyIds.length === 1) {
        result.set(entry.id, moneyIds[0]!)
        continue
      }
      if (moneyIds.length > 1) {
        refusals.set(entry.id, { reason: 'ambiguous' })
        continue
      }
      const near = graded.filter((c) => c.railOk !== c.amountOk)
      const nearIds = [...new Set(near.map((c) => c.money.id))]
      const reasons = new Set(near.map((c) => (c.railOk ? 'amount_differs' : 'rail_differs')))
      refusals.set(
        entry.id,
        nearIds.length === 1 && reasons.size === 1
          ? {
              reason: [...reasons][0] as 'amount_differs' | 'rail_differs',
              candidateMoneyTransactionId: nearIds[0]!,
            }
          : { reason: 'ambiguous' }
      )
    }
  }
  return { matches: result, refusals }
}
