// packages/lib/src/accounting/money/checkout/reads.ts

/**
 * What online checkout needs to know before it can charge, and what it wrote.
 *
 * The money-model rebuild of the reads the legacy Stripe rail did off
 * `PaymentTransaction` (accounting migration step 0). A paid invoice checkout is
 * a `MoneyTransaction` applied to the invoice; a paid quote deposit is a
 * `MoneyTransaction` with no application at all, and the durable link it has to
 * the quote is `MoneyTransaction.quoteInstanceId` itself (MIGRATION follow-up 7).
 *
 * No permission checks here - the token IS the capability on the public pages,
 * and the router asserts everywhere else (docs/lib-module-guide.md §6).
 */

import { type Database, database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import { firstTyped } from '../../../field-values/client'
import { UnifiedCrudHandler } from '../../../resources/crud'
import { systemFieldMap } from '../../../resources/system-records'
import { listPaymentGateways } from '../../rails/reads'
import { isPaymentsConnected } from '../../sales/public-token'
import { netApplied } from '../client'
import { sumAppliedByMovement } from '../reads'
import { getPaymentAccount } from '../stripe-connect/account'

/** The `MoneyCommand.kind` a quote-deposit checkout is recorded under. */
export const QUOTE_DEPOSIT_COMMAND_KIND = 'stripe_quote_deposit'

/** The `MoneyCommand.kind` an invoice checkout is recorded under. */
export const INVOICE_CHECKOUT_COMMAND_KIND = 'stripe_invoice_checkout'

/** An `EntityInstance` id out of a relationship-typed field value, or null. */
export function relatedInstanceId(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): string | null {
  const typed = firstTyped(entry)
  return typed?.type === 'relationship' ? parseRecordId(typed.recordId).entityInstanceId : null
}

/** The gateway a Stripe Connect charge settles through, or null when none is configured. */
export interface StripeRail {
  paymentGatewayId: string
  clearingGlAccountId: string
}

/**
 * The org's active Stripe rail.
 *
 * 🛑 Exactly one, or none: two active `stripe` gateways cannot be told apart
 * from a Connect event, and guessing would file a receipt against the wrong
 * clearing account.
 */
export async function resolveStripeRail(
  db: Database,
  organizationId: string
): Promise<StripeRail | null> {
  const gateways = await listPaymentGateways(db, organizationId)
  if (gateways.isErr()) return null
  const stripe = gateways.value.filter(
    (gateway) =>
      gateway.settlementSource === 'stripe' &&
      gateway.status === 'active' &&
      !!gateway.clearingGlAccountId.trim()
  )
  if (stripe.length !== 1) return null
  return {
    paymentGatewayId: stripe[0]!.id,
    clearingGlAccountId: stripe[0]!.clearingGlAccountId.trim(),
  }
}

/** Whether this org can take an online payment right now. */
export async function isCheckoutAvailable(organizationId: string): Promise<boolean> {
  const account = await getPaymentAccount(organizationId)
  return isPaymentsConnected(account)
}

/** The invoice facts a checkout session is built from. */
export interface InvoiceCheckoutTarget {
  number: string
  status: string
  /** Integer minor units. */
  balanceMinor: number
  contactInstanceId: string | null
}

export async function readInvoiceCheckoutTarget(
  organizationId: string,
  invoiceInstanceId: string
): Promise<InvoiceCheckoutTarget> {
  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const handler = new UnifiedCrudHandler(organizationId, systemUserId)
  const cf = await systemFieldMap(undefined, organizationId, [
    'invoice_status',
    'invoice_number',
    'invoice_balance',
    'invoice_contact',
  ] as const)
  const fieldIds = [cf.invoice_status, cf.invoice_number, cf.invoice_balance, cf.invoice_contact]
    .filter(Boolean)
    .map((field) => field!.id)
  const values = await handler.getFieldValues(toRecordId('invoice', invoiceInstanceId), fieldIds)
  const status = cf.invoice_status ? firstTyped(values.get(cf.invoice_status.id)) : undefined
  const number = cf.invoice_number ? firstTyped(values.get(cf.invoice_number.id)) : undefined
  const balance = cf.invoice_balance ? firstTyped(values.get(cf.invoice_balance.id)) : undefined
  return {
    number: number ? (extractValue(number) as string) : invoiceInstanceId,
    status: status ? (extractValue(status) as string) : 'unknown',
    balanceMinor: balance ? (extractValue(balance) as number) : 0,
    contactInstanceId: cf.invoice_contact
      ? relatedInstanceId(values.get(cf.invoice_contact.id))
      : null,
  }
}

/** The quote facts a deposit checkout session is built from. */
export interface QuoteCheckoutTarget {
  number: string
  status: string
  /** Integer minor units. */
  totalMinor: number
  contactInstanceId: string | null
  workOrderInstanceId: string | null
}

export async function readQuoteCheckoutTarget(
  organizationId: string,
  quoteInstanceId: string
): Promise<QuoteCheckoutTarget> {
  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const handler = new UnifiedCrudHandler(organizationId, systemUserId)
  const cf = await systemFieldMap(undefined, organizationId, [
    'quote_status',
    'quote_number',
    'quote_total',
    'quote_contact',
    'quote_work_orders',
  ] as const)
  const fieldIds = [
    cf.quote_status,
    cf.quote_number,
    cf.quote_total,
    cf.quote_contact,
    cf.quote_work_orders,
  ]
    .filter(Boolean)
    .map((field) => field!.id)
  const values = await handler.getFieldValues(toRecordId('quote', quoteInstanceId), fieldIds)
  const status = cf.quote_status ? firstTyped(values.get(cf.quote_status.id)) : undefined
  const number = cf.quote_number ? firstTyped(values.get(cf.quote_number.id)) : undefined
  const total = cf.quote_total ? firstTyped(values.get(cf.quote_total.id)) : undefined
  return {
    number: number ? (extractValue(number) as string) : quoteInstanceId,
    status: status ? (extractValue(status) as string) : 'unknown',
    totalMinor: total ? (extractValue(total) as number) : 0,
    contactInstanceId: cf.quote_contact ? relatedInstanceId(values.get(cf.quote_contact.id)) : null,
    workOrderInstanceId: cf.quote_work_orders
      ? relatedInstanceId(values.get(cf.quote_work_orders.id))
      : null,
  }
}

/** One deposit receipt taken against a quote. */
export interface QuoteDepositReceipt {
  moneyTransactionId: string
  /** Integer minor units. */
  amountMinor: number
  /** Integer minor units already applied to an invoice off this receipt. */
  appliedMinor: number
  occurredAt: string
  reference: string | null
  workOrderInstanceId: string | null
  /** The quote the deposit was collected against. */
  quoteInstanceId: string | null
}

/**
 * Every deposit receipt held against a quote, oldest first.
 *
 * MIGRATION follow-up 7: filtered on `MoneyTransaction.quoteInstanceId` itself,
 * a column only the deposit checkout ever writes - no join to `MoneyCommand` needed.
 */
export async function listQuoteDepositReceipts(
  db: Database,
  organizationId: string,
  quoteInstanceId: string
): Promise<QuoteDepositReceipt[]> {
  return listDepositReceipts(db, organizationId, 'quoteInstanceId', quoteInstanceId)
}

/**
 * Every deposit receipt held against a WORK ORDER, oldest first - the quotes
 * that converted into it, read off `MoneyTransaction.workOrderInstanceId`.
 */
export async function listWorkOrderDepositReceipts(
  db: Database,
  organizationId: string,
  workOrderInstanceId: string
): Promise<QuoteDepositReceipt[]> {
  return listDepositReceipts(db, organizationId, 'workOrderInstanceId', workOrderInstanceId)
}

/** The shared body of the two above: same read, different owning column. */
async function listDepositReceipts(
  db: Database,
  organizationId: string,
  owner: 'quoteInstanceId' | 'workOrderInstanceId',
  ownerInstanceId: string
): Promise<QuoteDepositReceipt[]> {
  const rows = await db
    .select({
      id: schema.MoneyTransaction.id,
      amountMinor: schema.MoneyTransaction.amountMinor,
      occurredAt: schema.MoneyTransaction.occurredAt,
      occurredOn: schema.MoneyTransaction.occurredOn,
      reference: schema.MoneyTransaction.reference,
      quoteInstanceId: schema.MoneyTransaction.quoteInstanceId,
      workOrderInstanceId: schema.MoneyTransaction.workOrderInstanceId,
    })
    .from(schema.MoneyTransaction)
    .where(
      and(
        eq(schema.MoneyTransaction.organizationId, organizationId),
        eq(schema.MoneyTransaction.purpose, 'customer_receipt'),
        eq(schema.MoneyTransaction[owner], ownerInstanceId)
      )
    )
  if (rows.length === 0) return []

  const appliedById = await sumAppliedByMovement(
    db,
    organizationId,
    rows.map((row) => row.id)
  )
  return rows
    .map((row) => ({
      moneyTransactionId: row.id,
      amountMinor: Number(row.amountMinor),
      appliedMinor: Number(appliedById.get(row.id) ?? 0n),
      occurredAt: row.occurredAt?.toISOString() ?? `${row.occurredOn}T00:00:00.000Z`,
      reference: row.reference,
      workOrderInstanceId: row.workOrderInstanceId,
      quoteInstanceId: row.quoteInstanceId,
    }))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
}

/** Held (unapplied) and applied deposit totals for a quote, integer minor units. */
export async function sumQuoteDeposits(
  db: Database,
  organizationId: string,
  quoteInstanceId: string
): Promise<{ heldMinor: number; appliedMinor: number }> {
  return sumDeposits(await listQuoteDepositReceipts(db, organizationId, quoteInstanceId))
}

/** Whether any deposit at all has been collected against a quote. */
export async function hasQuoteDeposit(
  organizationId: string,
  quoteInstanceId: string,
  db: Database = database
): Promise<boolean> {
  const rows = await listQuoteDepositReceipts(db, organizationId, quoteInstanceId)
  return rows.length > 0
}

/** Held and applied deposit totals for a work order, integer minor units. */
export async function sumWorkOrderDeposits(
  db: Database,
  organizationId: string,
  workOrderInstanceId: string
): Promise<{ heldMinor: number; appliedMinor: number }> {
  return sumDeposits(await listWorkOrderDepositReceipts(db, organizationId, workOrderInstanceId))
}

function sumDeposits(receipts: QuoteDepositReceipt[]): {
  heldMinor: number
  appliedMinor: number
} {
  return receipts.reduce(
    (sums, receipt) => ({
      heldMinor: sums.heldMinor + (receipt.amountMinor - receipt.appliedMinor),
      appliedMinor: sums.appliedMinor + receipt.appliedMinor,
    }),
    { heldMinor: 0, appliedMinor: 0 }
  )
}

/**
 * Money this customer has paid that no document has claimed yet, integer minor
 * units - the "credit on account" figure the billing overview reports.
 */
export async function sumUnappliedCustomerMoney(
  db: Database,
  organizationId: string,
  contactInstanceId: string
): Promise<number> {
  const receipts = await db.query.MoneyTransaction.findMany({
    where: and(
      eq(schema.MoneyTransaction.organizationId, organizationId),
      eq(schema.MoneyTransaction.purpose, 'customer_receipt'),
      eq(schema.MoneyTransaction.partyInstanceId, contactInstanceId)
    ),
  })
  if (receipts.length === 0) return 0
  const appliedById = await sumAppliedByMovement(
    db,
    organizationId,
    receipts.map((row) => row.id)
  )
  const applied = [...appliedById.values()].reduce((sum, net) => sum + net, 0n)
  const received = receipts.reduce((sum, row) => sum + row.amountMinor, 0n)
  return Math.max(0, Number(received - applied))
}

/**
 * Integer minor units applied to one invoice out of money that was HELD first -
 * a quote deposit, a prepayment. The labelled breakout line on the pay page; it
 * is already inside `amountPaid`, never money on top of it.
 */
export async function sumInvoiceDepositApplications(
  db: Database,
  organizationId: string,
  invoiceInstanceId: string
): Promise<number> {
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
    .innerJoin(
      schema.MoneyCommand,
      and(
        eq(schema.MoneyCommand.organizationId, schema.MoneyTransaction.organizationId),
        eq(schema.MoneyCommand.id, schema.MoneyTransaction.recordedByCommandId)
      )
    )
    .where(
      and(
        eq(schema.MoneyApplication.organizationId, organizationId),
        eq(schema.MoneyApplication.invoiceInstanceId, invoiceInstanceId),
        eq(schema.MoneyCommand.kind, QUOTE_DEPOSIT_COMMAND_KIND)
      )
    )
  return Number(netApplied(rows))
}
