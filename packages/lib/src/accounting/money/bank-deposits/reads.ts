// packages/lib/src/accounting/money/bank-deposits/reads.ts

/**
 * Every READ over bank deposits and the undeposited funds queue
 * (plans/accounting/tasks/done/06-deposit-grouping.md).
 *
 * Reads only. The writes live in `writes.ts`, because a file that both queries
 * and mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` §5).
 *
 * No permission checks anywhere in this file. The router asserts `ledgerView`
 * or `ledgerPost` and hands the narrowed filters down (§6).
 *
 * ⚠️ "Deposit" here always means a BANK deposit - N received payments banked as
 * one line. `money/payments/deposit.ts` is a customer prepayment, a liability,
 * and the two share nothing but the English word.
 */

import { type Database, schema } from '@auxx/database'
import { toDateKey } from '@auxx/utils/calendar-day'
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId } from '../../../cache'
import { type RecordId, toRecordId } from '../../../resources/resource-id'
import {
  readSystemRecords,
  type SystemRecord,
  systemInstanceColumns,
  systemRecordScope,
  systemValueJoin,
} from '../../../resources/system-records'
import { resolveBankDepositStatus } from './client'
import {
  type BankDepositAttribute,
  type DepositBankAccountContext,
  loadBankDepositFieldContext,
} from './fields'
import { guard } from './guard'
import type {
  BankDepositDetail,
  BankDepositRecord,
  ListBankDepositsFilters,
  ListUndepositedFilters,
  UndepositedPaymentRow,
} from './types'

/** `MoneyTransaction` columns every {@link UndepositedPaymentRow} is hydrated from. */
const RECEIPT_COLUMNS = {
  id: schema.MoneyTransaction.id,
  amountMinor: schema.MoneyTransaction.amountMinor,
  occurredAt: schema.MoneyTransaction.occurredAt,
  occurredOn: schema.MoneyTransaction.occurredOn,
  method: schema.MoneyTransaction.method,
  reference: schema.MoneyTransaction.reference,
  currency: schema.MoneyTransaction.currency,
  bankDepositInstanceId: schema.MoneyTransaction.bankDepositInstanceId,
  paymentGatewayId: schema.MoneyTransaction.paymentGatewayId,
  cashAccountInstanceId: schema.MoneyTransaction.cashAccountInstanceId,
  partyInstanceId: schema.MoneyTransaction.partyInstanceId,
} as const

/** What `createBankDeposit` needs off the row and the list must not leak. */
interface ReceiptWritePathFields {
  bankDepositId: string | null
  paymentGatewayId: string | null
  cashAccountInstanceId: string | null
}

/** The account a deposit is banked into, as this module needs it. */
export interface DepositBankAccount {
  id: string
  recordId: RecordId
  name: string | null
  /** Its `gl_account` mapping, trimmed. Null when the account is unmapped. Never a code. */
  glAccountId: string | null
  archivedAt: Date | null
}

const DEFAULT_LIMIT = 100

/**
 * One bank account, by id, org-scoped.
 *
 * Archived accounts are INCLUDED so the caller can refuse by name - "that
 * account is archived" is a better answer than "that account does not exist"
 * for an account the operator can see in a picker's history.
 */
export async function readDepositBankAccount(
  db: Database,
  organizationId: string,
  ctx: DepositBankAccountContext,
  bankAccountId: string
): Promise<DepositBankAccount | null> {
  const [record] = await readSystemRecords(db, organizationId, ctx, {
    ids: [bankAccountId],
    includeArchived: true,
  })
  if (!record) return null

  return {
    id: record.id,
    recordId: record.recordId,
    name: record.text('bank_account_name')?.trim() || null,
    glAccountId: record.text('bank_account_gl_account')?.trim() || null,
    archivedAt: record.archivedAt,
  }
}

/**
 * Receipts that are waiting to be banked: naming no rail and no bank account, and
 * in no deposit.
 *
 * MIGRATION follow-up 9: reads `MoneyTransaction` directly - `cashAccountInstanceId
 * IS NULL AND paymentGatewayId IS NULL` is what "sitting in undeposited funds"
 * means on the row itself, and `bankDepositInstanceId IS NULL` is "in no
 * deposit". All three are SQL filters.
 *
 * ⚠️ A receipt naming a rail or a bank account is never listed: it arrives at the
 * bank on its own line, or a payout drains it, and banking it would assert a bank
 * line that does not exist.
 */
export async function listUndepositedPayments(
  db: Database,
  params: { organizationId: string } & ListUndepositedFilters
): Promise<Result<UndepositedPaymentRow[], Error>> {
  const { organizationId, method, from, to, limit, offset } = params
  return guard(
    async () => {
      const where: SQL[] = [
        eq(schema.MoneyTransaction.organizationId, organizationId),
        eq(schema.MoneyTransaction.purpose, 'customer_receipt'),
        isNull(schema.MoneyTransaction.cashAccountInstanceId),
        isNull(schema.MoneyTransaction.paymentGatewayId),
        isNull(schema.MoneyTransaction.bankDepositInstanceId),
      ]
      // The explicit method filter stays as a plain predicate; it narrows the
      // list, it no longer decides what belongs in it.
      if (method) where.push(eq(schema.MoneyTransaction.method, method as never))
      // Hand-recorded receipts (the only kind that ever route to undeposited
      // funds) always carry `occurredOn` - `record-payment.ts` stamps
      // `datePrecision: 'date'`. A quote-deposit checkout's `instant` receipt has
      // no `occurredOn` and is excluded once a date filter narrows the query.
      if (from) where.push(gte(schema.MoneyTransaction.occurredOn, from))
      if (to) where.push(lte(schema.MoneyTransaction.occurredOn, to))

      const rows = await db
        .select(RECEIPT_COLUMNS)
        .from(schema.MoneyTransaction)
        .where(and(...where))
        .orderBy(desc(schema.MoneyTransaction.createdAt))
        .limit(limit ?? DEFAULT_LIMIT)
        .offset(offset ?? 0)

      // Drop the write-path-only fields rather than leak them onto the public
      // `UndepositedPaymentRow` shape.
      const hydrated = await hydrateReceipts(db, organizationId, rows)
      return hydrated.map(
        ({
          bankDepositId: _bankDepositId,
          paymentGatewayId: _paymentGatewayId,
          cashAccountInstanceId: _cashAccountInstanceId,
          ...row
        }) => row
      )
    },
    'Failed to list undeposited payments',
    { organizationId, method }
  )
}

/**
 * Turn a page of `MoneyTransaction` receipt rows into full
 * {@link UndepositedPaymentRow}s with a bounded number of queries: one for the
 * applications, one for the invoice display names. Never one per row.
 *
 * MIGRATION follow-up 9: every fact but the invoice name now lives on the
 * `MoneyTransaction` row itself - no `payment` entity mirror to join against.
 */
async function hydrateReceipts(
  db: Database,
  organizationId: string,
  page: Array<{
    id: string
    amountMinor: bigint
    occurredAt: Date | null
    occurredOn: string | null
    method: string | null
    reference: string | null
    currency: string
    bankDepositInstanceId: string | null
    paymentGatewayId: string | null
    cashAccountInstanceId: string | null
    partyInstanceId: string | null
  }>
): Promise<Array<UndepositedPaymentRow & ReceiptWritePathFields>> {
  if (page.length === 0) return []
  const ids = page.map((row) => row.id)

  // A hand-recorded receipt applies to one invoice, a channel receipt to one
  // order; either way the apply/unapply pairs are netted per target and the one
  // still positive wins, the same rule `listInvoiceMoneyPayments` reads by.
  const applications = await db.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      inArray(schema.MoneyApplication.moneyTransactionId, ids)
    ),
  })
  const invoiceIdByTransaction = netAppliedTarget(applications, 'invoiceInstanceId')
  const orderIdByTransaction = netAppliedTarget(applications, 'orderInstanceId')
  const [invoiceDefId, orderDefId, contactDefId] = await Promise.all(
    ['invoice', 'order', 'contact'].map((type) => getCachedEntityDefId(organizationId, type))
  )
  const recordId = (defId: string | undefined, instanceId: string | null) =>
    defId && instanceId ? toRecordId(defId, instanceId) : null

  const invoiceIds = [...new Set(invoiceIdByTransaction.values())]
  const invoiceNames = new Map<string, string | null>()
  if (invoiceIds.length > 0) {
    const invoices = await db
      .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          inArray(schema.EntityInstance.id, invoiceIds)
        )
      )
    for (const invoice of invoices) invoiceNames.set(invoice.id, invoice.displayName)
  }

  return page.map((row) => {
    const invoiceInstanceId = invoiceIdByTransaction.get(row.id) ?? null
    return {
      paymentId: row.id,
      amountMinor: Number(row.amountMinor),
      date: row.occurredOn ?? row.occurredAt?.toISOString().slice(0, 10) ?? null,
      method: row.method,
      // Channel money's `reference` is the provider's own id; only a hand-recorded payment carries one somebody typed.
      reference: row.method ? row.reference : null,
      invoiceInstanceId,
      invoiceName: invoiceInstanceId ? (invoiceNames.get(invoiceInstanceId) ?? null) : null,
      invoiceRecordId: recordId(invoiceDefId, invoiceInstanceId),
      orderRecordId: recordId(orderDefId, orderIdByTransaction.get(row.id) ?? null),
      partyRecordId: recordId(contactDefId, row.partyInstanceId),
      currency: row.currency,
      bankDepositId: row.bankDepositInstanceId,
      paymentGatewayId: row.paymentGatewayId,
      cashAccountInstanceId: row.cashAccountInstanceId,
    }
  })
}

/** Per transaction, the one `key` target its applications still net positive against. */
function netAppliedTarget(
  applications: Array<{
    moneyTransactionId: string
    operation: string
    amountMinor: bigint
    invoiceInstanceId: string | null
    orderInstanceId: string | null
  }>,
  key: 'invoiceInstanceId' | 'orderInstanceId'
): Map<string, string> {
  const netByTransaction = new Map<string, Map<string, bigint>>()
  for (const row of applications) {
    const target = row[key]
    if (!target) continue
    const byTarget = netByTransaction.get(row.moneyTransactionId) ?? new Map<string, bigint>()
    const delta = row.operation === 'apply' ? row.amountMinor : -row.amountMinor
    byTarget.set(target, (byTarget.get(target) ?? 0n) + delta)
    netByTransaction.set(row.moneyTransactionId, byTarget)
  }
  const result = new Map<string, string>()
  for (const [transactionId, byTarget] of netByTransaction) {
    for (const [target, net] of byTarget) {
      if (net > 0n) {
        result.set(transactionId, target)
        break
      }
    }
  }
  return result
}

/** Recorded bank deposits, newest first. */
export async function listBankDeposits(
  db: Database,
  params: { organizationId: string } & ListBankDepositsFilters
): Promise<Result<BankDepositRecord[], Error>> {
  const { organizationId, status, limit, offset } = params
  return guard(
    async () => {
      const ctx = await loadBankDepositFieldContext(db, organizationId)
      if (!ctx) return []

      const where: SQL[] = [systemRecordScope(organizationId, ctx.defId)]

      // Paged in SQL, because `readSystemRecords` has no `limit`/`offset`: the
      // page is cut here and its rows handed to the reader.
      let query = db.select(systemInstanceColumns).from(schema.EntityInstance).$dynamic()

      if (status && ctx.fields.bank_deposit_status) {
        const statusValue = alias(schema.FieldValue, 'bank_deposit_status_v')
        query = query.innerJoin(
          statusValue,
          and(
            systemValueJoin(statusValue, ctx.fields.bank_deposit_status.id),
            eq(statusValue.optionId, status)
          )
        )
      }

      const rows = await query
        .where(and(...where))
        .orderBy(desc(schema.EntityInstance.createdAt))
        .limit(limit ?? DEFAULT_LIMIT)
        .offset(offset ?? 0)

      if (rows.length === 0) return []
      const page = await readSystemRecords(db, organizationId, ctx, { instances: rows })
      return page.map(toBankDepositRecord)
    },
    'Failed to list bank deposits',
    { organizationId }
  )
}

/** One deposit with the payments it grouped, or `null` when it does not exist. */
export async function getBankDeposit(
  db: Database,
  params: { organizationId: string; depositId: string }
): Promise<Result<BankDepositDetail | null, Error>> {
  const { organizationId, depositId } = params
  return guard(
    async () => readBankDepositDetail(db, organizationId, depositId),
    'Failed to read bank deposit',
    {
      organizationId,
      depositId,
    }
  )
}

/** The unwrapped body of {@link getBankDeposit} - `writes.ts` reads it back too. */
export async function readBankDepositDetail(
  db: Database,
  organizationId: string,
  depositId: string
): Promise<BankDepositDetail | null> {
  const ctx = await loadBankDepositFieldContext(db, organizationId)
  if (!ctx) return null

  // Def-scoped, org-scoped and live-only, all inside the reader's own instance query.
  const [record] = await readSystemRecords(db, organizationId, ctx, { ids: [depositId] })
  if (!record) return null

  return {
    ...toBankDepositRecord(record),
    payments: await readDepositPayments(db, organizationId, depositId),
  }
}

/**
 * The receipts linked to one deposit, oldest first.
 *
 * MIGRATION follow-up 9: `MoneyTransaction.bankDepositInstanceId` is now the
 * owning side `createBankDeposit` writes, so it is the one that cannot be stale.
 */
export async function readDepositPayments(
  db: Database,
  organizationId: string,
  depositId: string
): Promise<UndepositedPaymentRow[]> {
  const rows = await db
    .select(RECEIPT_COLUMNS)
    .from(schema.MoneyTransaction)
    .where(
      and(
        eq(schema.MoneyTransaction.organizationId, organizationId),
        eq(schema.MoneyTransaction.purpose, 'customer_receipt'),
        eq(schema.MoneyTransaction.bankDepositInstanceId, depositId)
      )
    )
    .orderBy(asc(schema.MoneyTransaction.createdAt))

  const hydrated = await hydrateReceipts(db, organizationId, rows)
  return hydrated.map(({ bankDepositId: _bankDepositId, ...row }) => row)
}

/** Read a page of receipts by id, whatever their deposit state - the write path's loader. */
export async function readPaymentsByIds(
  db: Database,
  organizationId: string,
  paymentIds: string[]
): Promise<Array<UndepositedPaymentRow & ReceiptWritePathFields>> {
  if (paymentIds.length === 0) return []
  const rows = await db
    .select(RECEIPT_COLUMNS)
    .from(schema.MoneyTransaction)
    .where(
      and(
        eq(schema.MoneyTransaction.organizationId, organizationId),
        eq(schema.MoneyTransaction.purpose, 'customer_receipt'),
        inArray(schema.MoneyTransaction.id, paymentIds)
      )
    )

  return hydrateReceipts(db, organizationId, rows)
}

/**
 * One system record, as a {@link BankDepositRecord}.
 *
 * 🛑 `bank_deposit_date` is sliced to `YYYY-MM-DD`. `FieldValue.valueDate` is a
 * `timestamp(3) with time zone` in `mode: 'string'`, so a DATE field written as
 * `'2026-09-03'` reads back as `'2026-09-03 00:00:00+00'`, and every consumer of
 * `depositDate` compares it as a day: `updateBankDeposit` decides whether the
 * date actually changed from it, `groupByDay` keys its sections on it, the slip
 * renders it. Unsliced, an edit that only changed the reference is refused with
 * a `ConflictError` about a date nobody touched.
 *
 * Sliced rather than parsed: the stored instant is midnight UTC of the day that
 * was written, and re-parsing it through a local `Date` would move it a day.
 */
function toBankDepositRecord(record: SystemRecord<BankDepositAttribute>): BankDepositRecord {
  const instant = (attribute: BankDepositAttribute) => {
    const value = record.date(attribute)
    return value ? new Date(value) : null
  }
  const day = record.date('bank_deposit_date')
  return {
    depositId: record.id,
    recordId: record.recordId,
    number: record.text('bank_deposit_number'),
    depositDate: day ? toDateKey(day) : null,
    bankAccountId: record.related('bank_deposit_bank_account_record'),
    bankAccountGlAccountId: record.text('bank_deposit_bank_account'),
    reference: record.text('bank_deposit_reference'),
    status: resolveBankDepositStatus(record.option('bank_deposit_status')),
    totalMinor: Math.round(record.number('bank_deposit_total') ?? 0),
    bankTransactionId: record.text('bank_deposit_bank_transaction_id'),
    clearedAt: instant('bank_deposit_cleared_at'),
    reconciledAt: instant('bank_deposit_reconciled_at'),
    createdAt: record.createdAt,
  }
}
