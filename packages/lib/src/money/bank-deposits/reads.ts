// packages/lib/src/money/bank-deposits/reads.ts

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
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { type RecordId, toRecordId } from '../../resources/resource-id'
import { systemValueJoin } from '../../resources/system-records'
import { methodsRoutedToUndepositedFunds, resolveBankDepositStatus } from './client'
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
} as const

/** Every `bank_deposit` attribute a {@link BankDepositRecord} is assembled from. */
const DEPOSIT_ATTRIBUTES = [
  'bank_deposit_number',
  'bank_deposit_date',
  'bank_deposit_bank_account',
  'bank_deposit_bank_account_record',
  'bank_deposit_reference',
  'bank_deposit_status',
  'bank_deposit_total',
  'bank_deposit_bank_transaction_id',
  'bank_deposit_cleared_at',
  'bank_deposit_reconciled_at',
] as const

/**
 * The `bank_account` attributes a deposit needs to name the account it is banked
 * into.
 *
 * 🛑 Read through the entity layer rather than by importing `banking/`.
 * `banking/review/writes.ts` already imports `clearBankDeposit` from this
 * module, so a `money -> banking` import would close a cycle - the same
 * backwards edge `plans/bank-connection/09-data-connector-debt.md` D1 was about,
 * one feature over. A `bank_account` is an `EntityInstance` like any other and
 * this module already resolves `payment` and `bank_deposit` exactly this way.
 */
const BANK_ACCOUNT_ATTRIBUTES = [
  'bank_account_name',
  'bank_account_gl_account',
  'bank_account_has_posted',
] as const

type DepositAttribute = (typeof DEPOSIT_ATTRIBUTES)[number]

type DepositFields = Record<DepositAttribute, { id: string } | null>

type BankAccountAttribute = (typeof BANK_ACCOUNT_ATTRIBUTES)[number]

type BankAccountFields = Record<BankAccountAttribute, { id: string } | null>

const DEFAULT_LIMIT = 100

/** The resolved def and field ids every deposit read needs. */
export interface BankDepositFieldContext {
  depositDefId: string
  fields: DepositFields
}

/** The resolved `bank_account` def and the fields a deposit reads off it. */
export interface DepositBankAccountContext {
  bankAccountDefId: string
  fields: BankAccountFields
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

/**
 * Resolve the `bank_deposit` def and its fields, or `null` when the org has not
 * run entity migration 125 yet.
 *
 * `null` rather than a throw so a list surface on an unmigrated org renders
 * empty instead of 500ing. The WRITE paths call
 * {@link requireBankDepositFieldContext} instead: a write that silently did
 * nothing would be worse than a refusal.
 */
export async function loadBankDepositFieldContext(
  organizationId: string
): Promise<BankDepositFieldContext | null> {
  const depositDefId = await getCachedEntityDefId(organizationId, 'bank_deposit')
  if (!depositDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...DEPOSIT_ATTRIBUTES])) as DepositFields
  // Without `status` and `total` there is no deposit at all: the freeze rule and
  // the sum-must-equal-the-payments rule both reduce to "yes".
  if (!fields.bank_deposit_status || !fields.bank_deposit_total) return null
  return { depositDefId, fields }
}

/** {@link loadBankDepositFieldContext}, as the refusal a write path needs. */
export async function requireBankDepositFieldContext(
  organizationId: string
): Promise<BankDepositFieldContext> {
  const ctx = await loadBankDepositFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Bank deposits are not available until the bank deposit entity and its fields are ' +
        'provisioned (entity migration 125)'
    )
  }
  return ctx
}

/**
 * {@link requireBankDepositFieldContext} plus the link to the bank account.
 *
 * 🛑 Separate from the plain require, and only the CREATE path asks for it. A
 * deposit written without the link records the GL code alone, and a code cannot
 * be resolved back to an account (several map to one), so the row would sit
 * permanently outside the removal gate - the hole entity migration 135 closes.
 *
 * ⚠️ Clearing and correcting must NOT go through here. Neither writes the link,
 * and refusing them on an org that has 125 but not yet 135 would break matching
 * a bank line to a deposit that already exists - a path this field has nothing
 * to do with, between a deploy and the migration run.
 */
export async function requireBankDepositWriteContext(
  organizationId: string
): Promise<BankDepositFieldContext> {
  const ctx = await requireBankDepositFieldContext(organizationId)
  if (!ctx.fields.bank_deposit_bank_account_record) {
    throw new UnprocessableEntityError(
      'Recording a bank deposit is not available until the deposit bank account link is ' +
        'provisioned (entity migration 135)'
    )
  }
  return ctx
}

/**
 * Resolve the `bank_account` def and the fields a deposit reads off it.
 *
 * `null` when the org has no `bank_account` def, which is every org short of
 * entity migration 125.
 */
export async function loadDepositBankAccountContext(
  organizationId: string
): Promise<DepositBankAccountContext | null> {
  const bankAccountDefId = await getCachedEntityDefId(organizationId, 'bank_account')
  if (!bankAccountDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...BANK_ACCOUNT_ATTRIBUTES])) as BankAccountFields
  return { bankAccountDefId, fields }
}

/**
 * {@link loadDepositBankAccountContext}, as the refusal a write path needs.
 *
 * 🛑 The chart mapping is required, not optional. Without
 * `bank_account_gl_account` there is no account to debit and a deposit could
 * only be posted by guessing at a code the operator never named.
 */
export async function requireDepositBankAccountContext(
  organizationId: string
): Promise<DepositBankAccountContext> {
  const ctx = await loadDepositBankAccountContext(organizationId)
  if (!ctx?.fields.bank_account_gl_account) {
    throw new UnprocessableEntityError(
      'Banking a payment is not available until the bank account entity and its chart mapping ' +
        'are provisioned (entity migration 125)'
    )
  }
  return ctx
}

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
  const [instance] = await db
    .select({ id: schema.EntityInstance.id, archivedAt: schema.EntityInstance.archivedAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.bankAccountDefId),
        eq(schema.EntityInstance.id, bankAccountId)
      )
    )
    .limit(1)
  if (!instance) return null

  const fieldIds = [
    ctx.fields.bank_account_name?.id,
    ctx.fields.bank_account_gl_account?.id,
  ].filter((id): id is string => !!id)
  const values = fieldIds.length
    ? await db
        .select({ fieldId: schema.FieldValue.fieldId, valueText: schema.FieldValue.valueText })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.entityId, instance.id),
            inArray(schema.FieldValue.fieldId, fieldIds)
          )
        )
    : []
  const byField = new Map(values.map((row) => [row.fieldId, row.valueText]))
  const read = (attr: BankAccountAttribute) => {
    const id = ctx.fields[attr]?.id
    return id ? (byField.get(id) ?? null) : null
  }

  return {
    id: instance.id,
    recordId: toRecordId(ctx.bankAccountDefId, instance.id),
    name: read('bank_account_name')?.trim() || null,
    glAccountId: read('bank_account_gl_account')?.trim() || null,
    archivedAt: instance.archivedAt,
  }
}

/**
 * A stored date value, as `YYYY-MM-DD` (`@auxx/utils/calendar-day`'s `toDateKey`).
 *
 * 🛑 `FieldValue.valueDate` is a `timestamp(3) with time zone` in `mode: 'string'`,
 * so a DATE field written as `'2026-09-03'` reads back as
 * `'2026-09-03 00:00:00+00'`. Every consumer of this module's `depositDate` and
 * payment `date` is typed and compared as `YYYY-MM-DD`: `updateBankDeposit`
 * compares the caller's date against the stored one to decide whether the date
 * actually changed, `groupByDay` keys its sections on the string, and the deposit
 * slip renders it. Without this slice the comparison ALWAYS differs, so an edit
 * that only changed the reference is refused with a `ConflictError` about a date
 * nobody touched, and the slip's day sections split one day into two.
 *
 * Sliced rather than parsed: the stored instant is midnight UTC of the day that
 * was written, and re-parsing it through a local `Date` would move it a day in
 * either direction west or east of UTC.
 */

/**
 * Receipts that are waiting to be banked: routed to `undeposited_funds` by the
 * org's route table, and in no deposit.
 *
 * MIGRATION follow-up 9: reads `MoneyTransaction` directly - `cashAccountInstanceId
 * IS NULL` is what "sitting in undeposited funds" means on the row itself
 * (`record-payment.ts` only sets it for the `cash` route), and
 * `bankDepositInstanceId IS NULL` is "in no deposit". Both are SQL filters, no
 * FieldValue join needed now that neither fact lives on a `payment` entity mirror.
 *
 * ⚠️ An org whose route table sends NOTHING to undeposited funds gets an empty
 * list rather than every receipt. That is the correct answer, not a bug: with
 * every rail posting direct there is nothing to group.
 *
 * ⚠️ A receipt with NO method is listed when the `other` route points at
 * undeposited funds, because that is exactly where it was recorded. See
 * `includeMethodless` below - this read and `createBankDeposit` must resolve a
 * receipt's route identically, or undeposited funds carries a balance no
 * deposit can ever reach.
 */
export async function listUndepositedPayments(
  db: Database,
  params: { organizationId: string } & ListUndepositedFilters
): Promise<Result<UndepositedPaymentRow[], Error>> {
  const { organizationId, method, from, to, limit, offset } = params
  return guard(
    async () => {
      const settings = await getOrgCache().get(organizationId, 'orgSettings')
      const routed = methodsRoutedToUndepositedFunds(settings)
      // An explicit method filter still has to obey the route table: asking for
      // `card` when card routes to a clearing account must answer nothing, not
      // "here is a card receipt you can bank".
      const methods = method ? routed.filter((m) => m === method) : routed

      // Only when no explicit method filter was asked for: "show me the cheques"
      // must not answer with a receipt that has no method.
      const includeMethodless = !method && routed.includes('other')
      if (methods.length === 0 && !includeMethodless) return []

      const methodPredicate = includeMethodless
        ? or(
            isNull(schema.MoneyTransaction.method),
            inArray(schema.MoneyTransaction.method, methods)
          )!
        : inArray(schema.MoneyTransaction.method, methods)

      const where: SQL[] = [
        eq(schema.MoneyTransaction.organizationId, organizationId),
        eq(schema.MoneyTransaction.purpose, 'customer_receipt'),
        isNull(schema.MoneyTransaction.cashAccountInstanceId),
        isNull(schema.MoneyTransaction.bankDepositInstanceId),
        methodPredicate,
      ]
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

      // Every one of these rows is already `bankDepositInstanceId IS NULL`
      // (the WHERE clause above); drop the write-path-only field rather than
      // leak it onto the public `UndepositedPaymentRow` shape.
      const hydrated = await hydrateReceipts(db, organizationId, rows)
      return hydrated.map(({ bankDepositId: _bankDepositId, ...row }) => row)
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
  }>
): Promise<Array<UndepositedPaymentRow & { bankDepositId: string | null }>> {
  if (page.length === 0) return []
  const ids = page.map((row) => row.id)

  // A receipt is applied to at most one invoice in practice
  // (`record-payment.ts` applies immediately, one invoice, on write) - net the
  // apply/unapply pair per invoice per transaction and keep whichever invoice
  // still nets positive, the same rule `listInvoiceMoneyPayments` reads by.
  const applications = await db.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      inArray(schema.MoneyApplication.moneyTransactionId, ids)
    ),
  })
  const netByTransaction = new Map<string, Map<string, bigint>>()
  for (const row of applications) {
    if (!row.invoiceInstanceId) continue
    const byInvoice = netByTransaction.get(row.moneyTransactionId) ?? new Map<string, bigint>()
    const delta = row.operation === 'apply' ? row.amountMinor : -row.amountMinor
    byInvoice.set(row.invoiceInstanceId, (byInvoice.get(row.invoiceInstanceId) ?? 0n) + delta)
    netByTransaction.set(row.moneyTransactionId, byInvoice)
  }
  const invoiceIdByTransaction = new Map<string, string>()
  for (const [transactionId, byInvoice] of netByTransaction) {
    for (const [invoiceInstanceId, net] of byInvoice) {
      if (net > 0n) {
        invoiceIdByTransaction.set(transactionId, invoiceInstanceId)
        break
      }
    }
  }

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
      reference: row.reference,
      invoiceInstanceId,
      invoiceName: invoiceInstanceId ? (invoiceNames.get(invoiceInstanceId) ?? null) : null,
      currency: row.currency,
      bankDepositId: row.bankDepositInstanceId,
    }
  })
}

/** Recorded bank deposits, newest first. */
export async function listBankDeposits(
  db: Database,
  params: { organizationId: string } & ListBankDepositsFilters
): Promise<Result<BankDepositRecord[], Error>> {
  const { organizationId, status, limit, offset } = params
  return guard(
    async () => {
      const ctx = await loadBankDepositFieldContext(organizationId)
      if (!ctx) return []

      const where: SQL[] = [
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.depositDefId),
        isNull(schema.EntityInstance.archivedAt),
      ]

      let query = db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .$dynamic()

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
      return hydrateDeposits(db, organizationId, ctx, rows)
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
  const ctx = await loadBankDepositFieldContext(organizationId)
  if (!ctx) return null

  const [instance] = await db
    .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, depositId),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.depositDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  if (!instance) return null

  const [record] = await hydrateDeposits(db, organizationId, ctx, [instance])
  if (!record) return null

  return { ...record, payments: await readDepositPayments(db, organizationId, depositId) }
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
): Promise<Array<UndepositedPaymentRow & { bankDepositId: string | null }>> {
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

/** Turn a page of deposit ids into full rows with ONE additional query. */
async function hydrateDeposits(
  db: Database,
  organizationId: string,
  ctx: BankDepositFieldContext,
  page: { id: string; createdAt: Date }[]
): Promise<BankDepositRecord[]> {
  const ids = page.map((row) => row.id)
  const fieldIds = Object.values(ctx.fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)

  const values = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueDate: schema.FieldValue.valueDate,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, ids),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  const byInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  return page.map((row) => {
    const read = (attr: DepositAttribute) => {
      const id = ctx.fields[attr]?.id
      return id ? (byInstance.get(row.id)?.get(id) ?? null) : null
    }
    const date = (attr: DepositAttribute) => {
      const raw = read(attr)?.valueDate
      return raw ? new Date(raw) : null
    }
    const isoDay = (attr: DepositAttribute) => {
      const raw = read(attr)?.valueDate
      return raw ? toDateKey(raw) : null
    }
    return {
      depositId: row.id,
      recordId: toRecordId(ctx.depositDefId, row.id),
      number: read('bank_deposit_number')?.valueText ?? null,
      depositDate: isoDay('bank_deposit_date'),
      bankAccountId: read('bank_deposit_bank_account_record')?.relatedEntityId ?? null,
      bankAccountGlAccountId: read('bank_deposit_bank_account')?.valueText ?? null,
      reference: read('bank_deposit_reference')?.valueText ?? null,
      status: resolveBankDepositStatus(read('bank_deposit_status')?.optionId),
      totalMinor: Math.round(read('bank_deposit_total')?.valueNumber ?? 0),
      bankTransactionId: read('bank_deposit_bank_transaction_id')?.valueText ?? null,
      clearedAt: date('bank_deposit_cleared_at'),
      reconciledAt: date('bank_deposit_reconciled_at'),
      createdAt: row.createdAt,
    }
  })
}
