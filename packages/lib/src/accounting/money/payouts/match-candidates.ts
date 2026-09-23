// packages/lib/src/accounting/money/payouts/match-candidates.ts

/**
 * The receipt picker behind "Match to receipt" (§10.4): the customer movements a
 * person may vouch for against one processor item.
 *
 * Read-only, and no permission checks — the router asserts.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../../errors'
import { listApplicationsByMovement } from '../reads'
import { movementPurposeForEntryType } from './match-entries'

/** A document one candidate receipt is applied to — what the picker row shows. */
export interface CandidateDocument {
  kind: 'order' | 'invoice'
  instanceId: string
  displayName: string | null
}

export interface MatchCandidate {
  moneyTransactionId: string
  amountMinor: string
  currency: string
  currencyExponent: number
  /** Signed minor units: candidate amount less the item's gross. Zero is an exact amount. */
  differenceMinor: string
  occurredAt: string | null
  occurredOn: string | null
  reference: string | null
  /** The rail the receipt's own source account settles, when it has one. */
  paymentGatewayId: string | null
  documents: CandidateDocument[]
}

const LIMIT = 50

/**
 * Candidates for one item: same purpose, same currency, on the item's rail, not
 * already claimed by another item, closest amount first.
 *
 * 🛑 **Rail-strict when the item's feed HAS a rail.** The rail is what stops a
 * $60 Shopify Payments item matching a $60 Affirm receipt on the same order
 * (§8 D), and a picker that offered both would let a person undo that by hand.
 * When the feed has no rail at all (`no_rail`) there is nothing to be strict
 * about, so the filter is dropped rather than answering with an empty list on
 * exactly the screen §10.4 sends that case to.
 */
export async function listMatchCandidates(
  db: Database,
  input: { organizationId: string; entryId: string; query?: string; limit?: number }
): Promise<Result<MatchCandidate[], Error>> {
  const limit = Math.min(LIMIT, Math.max(1, input.limit ?? 20))
  const [entry] = await db
    .select({
      entry: schema.ProcessorBalanceEntry,
      paymentGatewayId: schema.FinancialSourceAccount.paymentGatewayId,
    })
    .from(schema.ProcessorBalanceEntry)
    .innerJoin(
      schema.FinancialSourceAccount,
      and(
        eq(
          schema.FinancialSourceAccount.organizationId,
          schema.ProcessorBalanceEntry.organizationId
        ),
        eq(schema.FinancialSourceAccount.id, schema.ProcessorBalanceEntry.sourceAccountId)
      )
    )
    .where(
      and(
        eq(schema.ProcessorBalanceEntry.organizationId, input.organizationId),
        eq(schema.ProcessorBalanceEntry.id, input.entryId)
      )
    )
    .limit(1)
  if (!entry) return err(new NotFoundError('Processor entry not found'))

  const gross = entry.entry.grossMinor < 0n ? -entry.entry.grossMinor : entry.entry.grossMinor
  const purpose = movementPurposeForEntryType(entry.entry.type)
  const search = input.query?.trim()
  const difference = sql<string>`(${schema.MoneyTransaction.amountMinor} - ${gross})`
  // The receipt's own gateway first: a store account takes payments on several.
  const gatewayOfReceipt = sql<
    string | null
  >`COALESCE(${schema.MoneyTransaction.paymentGatewayId}, ${schema.FinancialSourceAccount.paymentGatewayId})`

  const rows = await db
    .select({
      money: schema.MoneyTransaction,
      paymentGatewayId: gatewayOfReceipt,
      differenceMinor: difference,
    })
    .from(schema.MoneyTransaction)
    .leftJoin(
      schema.MoneySourceLink,
      and(
        eq(schema.MoneySourceLink.organizationId, schema.MoneyTransaction.organizationId),
        eq(schema.MoneySourceLink.moneyTransactionId, schema.MoneyTransaction.id)
      )
    )
    .leftJoin(
      schema.FinancialSourceObject,
      and(
        eq(schema.FinancialSourceObject.organizationId, schema.MoneySourceLink.organizationId),
        eq(schema.FinancialSourceObject.id, schema.MoneySourceLink.sourceObjectId)
      )
    )
    .leftJoin(
      schema.FinancialSourceAccount,
      and(
        eq(
          schema.FinancialSourceAccount.organizationId,
          schema.FinancialSourceObject.organizationId
        ),
        eq(schema.FinancialSourceAccount.id, schema.FinancialSourceObject.sourceAccountId)
      )
    )
    .where(
      and(
        eq(schema.MoneyTransaction.organizationId, input.organizationId),
        eq(schema.MoneyTransaction.purpose, purpose),
        eq(schema.MoneyTransaction.currency, entry.entry.currency),
        eq(schema.MoneyTransaction.currencyExponent, entry.entry.currencyExponent),
        entry.paymentGatewayId ? sql`${gatewayOfReceipt} = ${entry.paymentGatewayId}` : undefined,
        sql`NOT EXISTS (SELECT 1 FROM ${schema.ProcessorBalanceEntry} claimed WHERE claimed."organizationId" = ${input.organizationId} AND claimed."matchedMoneyTransactionId" = ${schema.MoneyTransaction.id} AND claimed.id <> ${input.entryId} AND claimed."matchState" = 'matched')`,
        search ? searchTerm(search, entry.entry.currencyExponent) : undefined
      )
    )
    .orderBy(sql`ABS(${difference}) ASC`, sql`${schema.MoneyTransaction.createdAt} DESC`)
    .limit(limit)

  const documents = await readApplicationDocuments(
    db,
    input.organizationId,
    rows.map((row) => row.money.id)
  )
  return ok(
    rows.map((row) => ({
      moneyTransactionId: row.money.id,
      amountMinor: row.money.amountMinor.toString(),
      currency: row.money.currency,
      currencyExponent: row.money.currencyExponent,
      differenceMinor: String(row.differenceMinor),
      occurredAt: row.money.occurredAt?.toISOString() ?? null,
      occurredOn: row.money.occurredOn,
      reference: row.money.reference,
      paymentGatewayId: row.paymentGatewayId ?? null,
      documents: documents.get(row.money.id) ?? [],
    }))
  )
}

/** An order number, an invoice number, the receipt's own reference, or an amount. */
function searchTerm(search: string, currencyExponent: number) {
  const like = `%${search}%`
  const digits = search.replace(/[^0-9.-]/g, '')
  const numeric = Number(digits)
  // `Number('')` is 0, and an amount term of zero would match every zero-value
  // receipt for a search that was pure text.
  const amount =
    /\d/.test(digits) && Number.isFinite(numeric)
      ? BigInt(Math.round(numeric * 10 ** currencyExponent))
      : null
  return or(
    sql`${schema.MoneyTransaction.reference} ILIKE ${like}`,
    amount === null ? undefined : eq(schema.MoneyTransaction.amountMinor, amount),
    sql`EXISTS (SELECT 1 FROM ${schema.MoneyApplication} a JOIN ${schema.EntityInstance} i ON i."organizationId" = a."organizationId" AND i.id IN (a."orderInstanceId", a."invoiceInstanceId") WHERE a."organizationId" = ${schema.MoneyTransaction.organizationId} AND a."moneyTransactionId" = ${schema.MoneyTransaction.id} AND a.operation = 'apply' AND i."displayName" ILIKE ${like})`
  )
}

/**
 * The order and invoice each receipt is applied to, with display names.
 *
 * Also the DTO the drawer's matched row uses, which is why it is exported rather
 * than inlined here.
 */
export async function readApplicationDocuments(
  db: Database,
  organizationId: string,
  moneyTransactionIds: readonly string[]
): Promise<Map<string, CandidateDocument[]>> {
  const ids = [...new Set(moneyTransactionIds)]
  const result = new Map<string, CandidateDocument[]>()
  if (!ids.length) return result
  const rows = (await listApplicationsByMovement(db, organizationId, ids)).filter(
    (row) => row.operation === 'apply' && (row.orderInstanceId || row.invoiceInstanceId)
  )
  const instanceIds = rows.flatMap((row) =>
    [row.orderInstanceId, row.invoiceInstanceId].filter((id): id is string => !!id)
  )
  const names = await readDisplayNames(db, organizationId, instanceIds)
  for (const row of rows) {
    const list = result.get(row.moneyTransactionId) ?? []
    for (const [kind, instanceId] of [
      ['order', row.orderInstanceId],
      ['invoice', row.invoiceInstanceId],
    ] as const) {
      if (!instanceId || list.some((doc) => doc.instanceId === instanceId)) continue
      list.push({ kind, instanceId, displayName: names.get(instanceId) ?? null })
    }
    result.set(row.moneyTransactionId, list)
  }
  return result
}

async function readDisplayNames(
  db: Database,
  organizationId: string,
  instanceIds: readonly string[]
): Promise<Map<string, string | null>> {
  const ids = [...new Set(instanceIds)]
  if (!ids.length) return new Map()
  const rows = await db
    .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, ids)
      )
    )
  return new Map(rows.map((row) => [row.id, row.displayName]))
}
