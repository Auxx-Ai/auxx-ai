// packages/lib/src/accounting/money/reads.ts

/**
 * The one reader for `MoneyTransaction`, `MoneyApplication`, `MoneyRefundSettlement`
 * and `MoneySourceLink` (plans/accounting/LIB-READS.md §2.1).
 *
 * Every door keeps its own refusal — a receipt's book-date check, a recognition
 * blocker, a poster's USD guard — and shares only the query underneath.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq, inArray, or, type SQL } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../errors'
import { netApplied } from './client'

export type MovementRow = typeof schema.MoneyTransaction.$inferSelect
export type MoneyApplicationRow = typeof schema.MoneyApplication.$inferSelect
export type MoneyRefundSettlementRow = typeof schema.MoneyRefundSettlement.$inferSelect
export type MoneySourceLinkRow = typeof schema.MoneySourceLink.$inferSelect

export interface ReadMovementOptions {
  /** Refuse a movement of another purpose by returning nothing. */
  purpose?: MovementRow['purpose']
}

/** Every named movement that exists in this org, keyed by id. */
export async function readMovements(
  db: Database | Transaction,
  organizationId: string,
  ids: string[],
  options: ReadMovementOptions = {}
): Promise<Map<string, MovementRow>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await db.query.MoneyTransaction.findMany({
    where: and(
      eq(schema.MoneyTransaction.organizationId, organizationId),
      inArray(schema.MoneyTransaction.id, unique),
      ...(options.purpose ? [eq(schema.MoneyTransaction.purpose, options.purpose)] : [])
    ),
  })
  return new Map(rows.map((row) => [row.id, row]))
}

/** One movement, or `null` when it is not in this org (or not of `purpose`). */
export async function readMovement(
  db: Database | Transaction,
  organizationId: string,
  id: string,
  options: ReadMovementOptions = {}
): Promise<MovementRow | null> {
  return (await readMovements(db, organizationId, [id], options)).get(id) ?? null
}

/**
 * The three refusals every poster shares: it exists, it is a confirmed USD
 * amount, and it knows when it happened.
 */
export function assertPostableMovement(
  money: MovementRow | null | undefined,
  label: string
): MovementRow {
  if (!money) throw new UnprocessableEntityError(`${label} movement does not exist`)
  if (money.currency !== 'USD' || money.currencyExponent !== 2)
    throw new UnprocessableEntityError(`${label} requires a confirmed USD amount`)
  if (
    (money.datePrecision === 'instant' && !money.occurredAt) ||
    (money.datePrecision === 'date' && !money.occurredOn)
  )
    throw new UnprocessableEntityError(`${label} occurrence date is incomplete`)
  return money
}

/** Every application row of the named movements, oldest first. */
export async function listApplicationsByMovement(
  db: Database | Transaction,
  organizationId: string,
  moneyTransactionIds: string[]
): Promise<MoneyApplicationRow[]> {
  const unique = [...new Set(moneyTransactionIds)]
  if (unique.length === 0) return []
  return db.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      inArray(schema.MoneyApplication.moneyTransactionId, unique)
    ),
    orderBy: asc(schema.MoneyApplication.id),
  })
}

/** Every application row of one movement, oldest first. */
export async function listMovementApplications(
  db: Database | Transaction,
  organizationId: string,
  moneyTransactionId: string
): Promise<MoneyApplicationRow[]> {
  return listApplicationsByMovement(db, organizationId, [moneyTransactionId])
}

/** The `apply` rows an `unapply` has not already reversed — see {@link listLiveApplications}. */
export function selectLiveApplications<
  T extends { id: string; operation: string; reversesApplicationId: string | null },
>(rows: T[]): T[] {
  const reversed = new Set(
    rows.flatMap((row) => (row.reversesApplicationId ? [row.reversesApplicationId] : []))
  )
  return rows.filter((row) => row.operation === 'apply' && !reversed.has(row.id))
}

/**
 * The `apply` rows of a movement that are still standing.
 *
 * An application already named by an `unapply.reversesApplicationId` has left
 * its document; offering it again writes a second reversal against a document
 * that no longer holds the money (LIB-READS §0.1 bug 1).
 */
export async function listLiveApplications(
  db: Database | Transaction,
  organizationId: string,
  moneyTransactionId: string,
  options: { invoiceInstanceId?: string } = {}
): Promise<MoneyApplicationRow[]> {
  const rows = await listMovementApplications(db, organizationId, moneyTransactionId)
  const live = selectLiveApplications(rows)
  return options.invoiceInstanceId
    ? live.filter((row) => row.invoiceInstanceId === options.invoiceInstanceId)
    : live
}

/** Applied minus unapplied, per movement. Movements with no rows are absent. */
export async function sumAppliedByMovement(
  db: Database | Transaction,
  organizationId: string,
  ids: string[]
): Promise<Map<string, bigint>> {
  const rows = await listApplicationsByMovement(db, organizationId, ids)
  const sums = new Map<string, bigint>()
  for (const row of rows) {
    const delta = row.operation === 'apply' ? row.amountMinor : -row.amountMinor
    sums.set(row.moneyTransactionId, (sums.get(row.moneyTransactionId) ?? 0n) + delta)
  }
  return sums
}

/** Applied minus unapplied for one movement. */
export async function sumAppliedToMovement(
  db: Database | Transaction,
  organizationId: string,
  moneyTransactionId: string
): Promise<bigint> {
  return (
    (await sumAppliedByMovement(db, organizationId, [moneyTransactionId])).get(
      moneyTransactionId
    ) ?? 0n
  )
}

/**
 * Applied minus unapplied against one invoice.
 *
 * The default counts EVERY application: a balance check that ignored a
 * non-receipt application would relieve the same receivable twice. The drawer's
 * list is the one caller that filters to receipts (LIB-READS §0.2).
 */
export async function sumAppliedToInvoice(
  db: Database | Transaction,
  organizationId: string,
  invoiceInstanceId: string,
  options: { receiptsOnly?: boolean } = {}
): Promise<bigint> {
  if (!options.receiptsOnly)
    return netApplied(await listInvoiceApplications(db, organizationId, invoiceInstanceId))
  const rows = await db
    .select({
      operation: schema.MoneyApplication.operation,
      amountMinor: schema.MoneyApplication.amountMinor,
    })
    .from(schema.MoneyApplication)
    .innerJoin(
      schema.MoneyTransaction,
      and(
        eq(schema.MoneyTransaction.organizationId, schema.MoneyApplication.organizationId),
        eq(schema.MoneyTransaction.id, schema.MoneyApplication.moneyTransactionId)
      )
    )
    .where(
      and(
        eq(schema.MoneyApplication.organizationId, organizationId),
        eq(schema.MoneyApplication.invoiceInstanceId, invoiceInstanceId),
        eq(schema.MoneyTransaction.purpose, 'customer_receipt')
      )
    )
  return netApplied(rows)
}

/** Every application against one invoice, oldest first. */
export async function listInvoiceApplications(
  db: Database | Transaction,
  organizationId: string,
  invoiceInstanceId: string
): Promise<MoneyApplicationRow[]> {
  return db.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.invoiceInstanceId, invoiceInstanceId)
    ),
    orderBy: asc(schema.MoneyApplication.id),
  })
}

/** Every application against one vendor bill, oldest first. */
export async function listVendorBillApplications(
  db: Database | Transaction,
  organizationId: string,
  vendorBillInstanceId: string
): Promise<MoneyApplicationRow[]> {
  return db.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.vendorBillInstanceId, vendorBillInstanceId)
    ),
    orderBy: asc(schema.MoneyApplication.id),
  })
}

/**
 * The money and the early-payment discount settled against one vendor bill,
 * each netted over apply/unapply (74 D3).
 */
export async function sumAppliedToVendorBill(
  db: Database | Transaction,
  organizationId: string,
  vendorBillInstanceId: string
): Promise<{ amountMinor: bigint; discountMinor: bigint }> {
  const rows = await listVendorBillApplications(db, organizationId, vendorBillInstanceId)
  return {
    amountMinor: netApplied(rows),
    discountMinor: rows.reduce(
      (sum, row) => sum + (row.operation === 'apply' ? 1n : -1n) * (row.discountMinor ?? 0n),
      0n
    ),
  }
}

/** Every application against one order, oldest first. */
export async function listOrderApplications(
  db: Database | Transaction,
  organizationId: string,
  orderInstanceId: string
): Promise<MoneyApplicationRow[]> {
  return db.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.orderInstanceId, orderInstanceId)
    ),
    orderBy: asc(schema.MoneyApplication.createdAt),
  })
}

/** Applied minus unapplied against one order. */
export async function sumAppliedToOrder(
  db: Database | Transaction,
  organizationId: string,
  orderInstanceId: string
): Promise<bigint> {
  return netApplied(await listOrderApplications(db, organizationId, orderInstanceId))
}

/** Which refund settlements to read; the identity keys are OR'd, `disposition` narrows. */
export interface RefundSettlementFilter {
  refundTransactionId?: string
  originalTransactionIds?: string[]
  customerCreditMemoInstanceId?: string
  vendorCreditInstanceId?: string
  disposition?: MoneyRefundSettlementRow['disposition']
}

/** Refund settlements matching any of the identity keys, oldest first. */
export async function listRefundSettlements(
  db: Database | Transaction,
  organizationId: string,
  filter: RefundSettlementFilter
): Promise<MoneyRefundSettlementRow[]> {
  const identity: SQL[] = []
  if (filter.refundTransactionId)
    identity.push(eq(schema.MoneyRefundSettlement.refundTransactionId, filter.refundTransactionId))
  if (filter.originalTransactionIds) {
    const ids = [...new Set(filter.originalTransactionIds)]
    if (ids.length === 0 && identity.length === 0) return []
    if (ids.length > 0)
      identity.push(inArray(schema.MoneyRefundSettlement.originalTransactionId, ids))
  }
  if (filter.customerCreditMemoInstanceId)
    identity.push(
      eq(
        schema.MoneyRefundSettlement.customerCreditMemoInstanceId,
        filter.customerCreditMemoInstanceId
      )
    )
  if (filter.vendorCreditInstanceId)
    identity.push(
      eq(schema.MoneyRefundSettlement.vendorCreditInstanceId, filter.vendorCreditInstanceId)
    )
  if (identity.length === 0) return []
  return db.query.MoneyRefundSettlement.findMany({
    where: and(
      eq(schema.MoneyRefundSettlement.organizationId, organizationId),
      identity.length === 1 ? identity[0] : or(...identity),
      ...(filter.disposition
        ? [eq(schema.MoneyRefundSettlement.disposition, filter.disposition)]
        : [])
    ),
    orderBy: asc(schema.MoneyRefundSettlement.id),
  })
}

/** The movements the named source objects were materialized into, keyed by object id. */
export async function findSourceLinks(
  db: Database | Transaction,
  organizationId: string,
  sourceObjectIds: string[]
): Promise<Map<string, MoneySourceLinkRow>> {
  const unique = [...new Set(sourceObjectIds)]
  if (unique.length === 0) return new Map()
  const rows = await db.query.MoneySourceLink.findMany({
    where: and(
      eq(schema.MoneySourceLink.organizationId, organizationId),
      inArray(schema.MoneySourceLink.sourceObjectId, unique)
    ),
  })
  return new Map(rows.map((row) => [row.sourceObjectId, row]))
}

/** The movement one source object was materialized into, if any. */
export async function findSourceLink(
  db: Database | Transaction,
  organizationId: string,
  sourceObjectId: string
): Promise<MoneySourceLinkRow | null> {
  return (await findSourceLinks(db, organizationId, [sourceObjectId])).get(sourceObjectId) ?? null
}
