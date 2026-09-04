// packages/lib/src/money/bank-deposits/reads.ts

/**
 * Every READ over bank deposits and the undeposited funds queue
 * (plans/accounting/tasks/06-deposit-grouping.md).
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
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { toRecordId } from '../../resources/resource-id'
import { methodsRoutedToUndepositedFunds, resolveBankDepositStatus } from './client'
import { guard } from './guard'
import type {
  BankDepositDetail,
  BankDepositRecord,
  ListBankDepositsFilters,
  ListUndepositedFilters,
  UndepositedPaymentRow,
} from './types'

/** Every `bank_deposit` attribute a {@link BankDepositRecord} is assembled from. */
const DEPOSIT_ATTRIBUTES = [
  'bank_deposit_number',
  'bank_deposit_date',
  'bank_deposit_bank_account',
  'bank_deposit_reference',
  'bank_deposit_status',
  'bank_deposit_total',
  'bank_deposit_bank_transaction_id',
  'bank_deposit_cleared_at',
  'bank_deposit_reconciled_at',
  'bank_deposit_gl_posting_id',
] as const

/** Every `payment` attribute an {@link UndepositedPaymentRow} is assembled from. */
const PAYMENT_ATTRIBUTES = [
  'payment_amount',
  'payment_date',
  'payment_method',
  'payment_reference',
  'payment_invoice',
  'payment_transaction_id',
  'payment_bank_deposit',
] as const

type DepositAttribute = (typeof DEPOSIT_ATTRIBUTES)[number]
type PaymentAttribute = (typeof PAYMENT_ATTRIBUTES)[number]

type DepositFields = Record<DepositAttribute, { id: string } | null>
type PaymentFields = Record<PaymentAttribute, { id: string } | null>

const DEFAULT_LIMIT = 100

/** The resolved def and field ids every deposit read needs. */
export interface BankDepositFieldContext {
  depositDefId: string
  fields: DepositFields
}

/** The resolved def and field ids every payment read needs. */
export interface PaymentFieldContext {
  paymentDefId: string
  fields: PaymentFields
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

/** Resolve the `payment` def and the fields a deposit reads and stamps. */
export async function loadPaymentFieldContext(
  organizationId: string
): Promise<PaymentFieldContext | null> {
  const paymentDefId = await getCachedEntityDefId(organizationId, 'payment')
  if (!paymentDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...PAYMENT_ATTRIBUTES])) as PaymentFields
  if (!fields.payment_amount || !fields.payment_method) return null
  return { paymentDefId, fields }
}

/** {@link loadPaymentFieldContext}, as the refusal a write path needs. */
export async function requirePaymentFieldContext(
  organizationId: string
): Promise<PaymentFieldContext> {
  const ctx = await loadPaymentFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Grouping payments is not available until the payment entity and its fields are provisioned'
    )
  }
  // The link field is what makes "one deposit per payment" answerable at all. An
  // org short of migration 125 has no way to record which deposit a cheque went
  // into, and grouping there would produce a deposit that cannot be un-grouped.
  if (!ctx.fields.payment_bank_deposit) {
    throw new UnprocessableEntityError(
      'Grouping payments is not available until the payment bank deposit link is provisioned ' +
        '(entity migration 125)'
    )
  }
  return ctx
}

/**
 * A stored date value, as `YYYY-MM-DD`.
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
function toIsoDay(raw: string | null | undefined): string | null {
  return raw ? raw.slice(0, 10) : null
}

/** An aliased `FieldValue` table, as `alias()` returns it. */
type FieldValueAlias = ReturnType<typeof alias<typeof schema.FieldValue, string>>

/**
 * Join predicate for "this instance's value of <field>".
 *
 * Takes the alias OBJECT and composes with `eq`, so drizzle emits the table as
 * an identifier. A hand-written `sql` fragment interpolating a table binds it as
 * a parameter instead, a mistake this codebase has already paid for.
 */
function valueJoin(table: FieldValueAlias, fieldId: string): SQL | undefined {
  return and(
    eq(table.entityId, schema.EntityInstance.id),
    eq(table.organizationId, schema.EntityInstance.organizationId),
    eq(table.fieldId, fieldId)
  )
}

/**
 * Payments that are waiting to be banked: routed to `undeposited_funds` by the
 * org's route table, and in no deposit.
 *
 * 🛑 **Both halves of that sentence are filters in SQL, not in memory.** The
 * route half narrows on `payment_method` against
 * {@link methodsRoutedToUndepositedFunds}, so an ACH or a card receipt never
 * appears here - routing one into a deposit would assert a bank line the bank
 * never showed. The "in no deposit" half is a LEFT JOIN on
 * `payment_bank_deposit` plus `IS NULL`, so a payment with no value ROW at all
 * is included alongside one whose row is present and empty; an inner join would
 * drop the first group, which today is every payment there is.
 *
 * ⚠️ An org whose route table sends NOTHING to undeposited funds gets an empty
 * list rather than every payment. That is the correct answer, not a bug: with
 * every rail posting direct there is nothing to group.
 *
 * ⚠️ A payment with NO method is listed when the `other` route points at
 * undeposited funds, because that is exactly where the payment entry put its
 * money. See the comment on `includeMethodless` below - this read and
 * `createBankDeposit` must resolve the same payment the same way, or undeposited
 * funds carries a balance no deposit can ever reach.
 */
export async function listUndepositedPayments(
  db: Database,
  params: { organizationId: string } & ListUndepositedFilters
): Promise<Result<UndepositedPaymentRow[], Error>> {
  const { organizationId, method, from, to, limit, offset } = params
  return guard(
    async () => {
      const ctx = await loadPaymentFieldContext(organizationId)
      if (!ctx) return []

      const settings = await getOrgCache().get(organizationId, 'orgSettings')
      const routed = methodsRoutedToUndepositedFunds(settings)
      // An explicit method filter still has to obey the route table: asking for
      // `card` when card routes to a clearing account must answer nothing, not
      // "here is a card receipt you can bank".
      const methods = method ? routed.filter((m) => m === method) : routed

      // 🛑 A payment with NO method at all is a real row and it has a real
      // route. `resolvePaymentRoute(null, settings)` falls through to the
      // `other` row, and `postPaymentTransaction` posts it there - so when
      // `other` routes to undeposited funds, that payment's money IS sitting in
      // 1050 and it must be bankable. Dropping it here while
      // `createBankDeposit` happily accepts the same id (it resolves the route
      // the same way) is the disagreement this guard closes: the two doors now
      // answer identically, and undeposited funds can always be cleared to zero.
      //
      // Only when no explicit method filter was asked for: "show me the cheques"
      // must not answer with a payment that has no method.
      const includeMethodless = !method && routed.includes('other')
      if (methods.length === 0 && !includeMethodless) return []

      const where: SQL[] = [
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.paymentDefId),
        isNull(schema.EntityInstance.archivedAt),
      ]

      let query = db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .$dynamic()

      const methodField = ctx.fields.payment_method
      if (methodField) {
        const methodValue = alias(schema.FieldValue, 'payment_method_v')
        if (includeMethodless) {
          // A LEFT join, so a payment with no method value ROW at all survives
          // it, and the predicate then keeps the routed methods plus the empty
          // ones. An inner join cannot express that: it drops the row before the
          // predicate ever sees it.
          query = query.leftJoin(methodValue, valueJoin(methodValue, methodField.id))
          const predicates: SQL[] = [isNull(methodValue.optionId)]
          if (methods.length > 0) predicates.unshift(inArray(methodValue.optionId, methods))
          where.push(predicates.length === 1 ? predicates[0]! : or(...predicates)!)
        } else {
          query = query.innerJoin(
            methodValue,
            and(valueJoin(methodValue, methodField.id), inArray(methodValue.optionId, methods))
          )
        }
      }

      const dateField = ctx.fields.payment_date
      if (dateField && (from || to)) {
        const dateValue = alias(schema.FieldValue, 'payment_date_v')
        query = query.innerJoin(
          dateValue,
          and(
            valueJoin(dateValue, dateField.id),
            ...(from ? [gte(dateValue.valueDate, from)] : []),
            ...(to ? [lte(dateValue.valueDate, to)] : [])
          )
        )
      }

      // The "in no deposit" half. `payment_bank_deposit` is required by
      // `requirePaymentFieldContext` on the write path; here it is guarded, so a
      // read on an org short of 127 lists everything rather than throwing - and
      // the write path refuses before anything can be grouped.
      const linkField = ctx.fields.payment_bank_deposit
      if (linkField) {
        const linkValue = alias(schema.FieldValue, 'payment_deposit_v')
        query = query.leftJoin(linkValue, valueJoin(linkValue, linkField.id))
        where.push(isNull(linkValue.relatedEntityId))
      }

      const rows = await query
        .where(and(...where))
        .orderBy(desc(schema.EntityInstance.createdAt))
        .limit(limit ?? DEFAULT_LIMIT)
        .offset(offset ?? 0)

      if (rows.length === 0) return []
      return hydratePayments(db, organizationId, ctx, rows)
    },
    'Failed to list undeposited payments',
    { organizationId, method }
  )
}

/**
 * Turn a page of payment ids into full rows with a bounded number of queries:
 * one for the field values, one for the invoice display names, one for the
 * currencies. Never one per row.
 */
async function hydratePayments(
  db: Database,
  organizationId: string,
  ctx: PaymentFieldContext,
  page: { id: string }[]
): Promise<UndepositedPaymentRow[]> {
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

  const read = (instanceId: string, attr: PaymentAttribute) => {
    const id = ctx.fields[attr]?.id
    return id ? (byInstance.get(instanceId)?.get(id) ?? null) : null
  }

  const invoiceIds = [
    ...new Set(
      page
        .map((row) => read(row.id, 'payment_invoice')?.relatedEntityId)
        .filter((id): id is string => id != null)
    ),
  ]
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

  // Currency lives on the ledger row, not on the entity mirror: the `payment`
  // def carries amount/date/method and no currency at all. Reading it here is
  // what lets `createBankDeposit` refuse a mixed-currency deposit by name rather
  // than posting one at an implied 1.0 rate.
  const transactionIds = [
    ...new Set(
      page
        .map((row) => read(row.id, 'payment_transaction_id')?.valueText)
        .filter((id): id is string => !!id)
    ),
  ]
  const currencies = new Map<string, string>()
  if (transactionIds.length > 0) {
    const transactions = await db
      .select({ id: schema.PaymentTransaction.id, currency: schema.PaymentTransaction.currency })
      .from(schema.PaymentTransaction)
      .where(
        and(
          eq(schema.PaymentTransaction.organizationId, organizationId),
          inArray(schema.PaymentTransaction.id, transactionIds)
        )
      )
    for (const transaction of transactions) currencies.set(transaction.id, transaction.currency)
  }

  return page.map((row) => {
    const invoiceInstanceId = read(row.id, 'payment_invoice')?.relatedEntityId ?? null
    const transactionId = read(row.id, 'payment_transaction_id')?.valueText ?? null
    return {
      paymentId: row.id,
      recordId: toRecordId(ctx.paymentDefId, row.id),
      // `valueNumber` is a DOUBLE. Every payment amount is already integer cents
      // by the MQ1 convention, so this rounds rather than truncates: a stored
      // 4119.999999 must read 4120, not 4119.
      amountMinor: Math.round(read(row.id, 'payment_amount')?.valueNumber ?? 0),
      date: toIsoDay(read(row.id, 'payment_date')?.valueDate),
      method: read(row.id, 'payment_method')?.optionId ?? null,
      reference: read(row.id, 'payment_reference')?.valueText ?? null,
      invoiceInstanceId,
      invoiceName: invoiceInstanceId ? (invoiceNames.get(invoiceInstanceId) ?? null) : null,
      currency: transactionId ? (currencies.get(transactionId) ?? null) : null,
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
            valueJoin(statusValue, ctx.fields.bank_deposit_status.id),
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
 * The payments linked to one deposit, oldest first.
 *
 * Read from the OWNING side (`payment_bank_deposit`) rather than from the
 * deposit's `bank_deposit_payments` inverse: the owning side is the one write
 * `createBankDeposit` makes, so it is the one that cannot be stale.
 */
export async function readDepositPayments(
  db: Database,
  organizationId: string,
  depositId: string
): Promise<UndepositedPaymentRow[]> {
  const ctx = await loadPaymentFieldContext(organizationId)
  if (!ctx?.fields.payment_bank_deposit) return []

  const linkValue = alias(schema.FieldValue, 'deposit_payment_v')
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      linkValue,
      and(
        valueJoin(linkValue, ctx.fields.payment_bank_deposit.id),
        eq(linkValue.relatedEntityId, depositId)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.paymentDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .orderBy(asc(schema.EntityInstance.createdAt))

  if (rows.length === 0) return []
  return hydratePayments(db, organizationId, ctx, rows)
}

/** Read a page of payments by id, whatever their deposit state - the write path's loader. */
export async function readPaymentsByIds(
  db: Database,
  organizationId: string,
  ctx: PaymentFieldContext,
  paymentIds: string[]
): Promise<Array<UndepositedPaymentRow & { bankDepositId: string | null }>> {
  if (paymentIds.length === 0) return []
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.paymentDefId),
        inArray(schema.EntityInstance.id, paymentIds),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  const hydrated = await hydratePayments(db, organizationId, ctx, rows)
  const linkFieldId = ctx.fields.payment_bank_deposit?.id
  if (!linkFieldId) return hydrated.map((row) => ({ ...row, bankDepositId: null }))

  const links = await db
    .select({
      entityId: schema.FieldValue.entityId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, linkFieldId),
        inArray(
          schema.FieldValue.entityId,
          rows.map((row) => row.id)
        )
      )
    )
  const byPayment = new Map(links.map((link) => [link.entityId, link.relatedEntityId]))
  return hydrated.map((row) => ({ ...row, bankDepositId: byPayment.get(row.paymentId) ?? null }))
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
    return {
      depositId: row.id,
      recordId: toRecordId(ctx.depositDefId, row.id),
      number: read('bank_deposit_number')?.valueText ?? null,
      depositDate: toIsoDay(read('bank_deposit_date')?.valueDate),
      bankAccountCode: read('bank_deposit_bank_account')?.valueText ?? null,
      reference: read('bank_deposit_reference')?.valueText ?? null,
      status: resolveBankDepositStatus(read('bank_deposit_status')?.optionId),
      totalMinor: Math.round(read('bank_deposit_total')?.valueNumber ?? 0),
      bankTransactionId: read('bank_deposit_bank_transaction_id')?.valueText ?? null,
      clearedAt: date('bank_deposit_cleared_at'),
      reconciledAt: date('bank_deposit_reconciled_at'),
      glPostingId: read('bank_deposit_gl_posting_id')?.valueText ?? null,
      createdAt: row.createdAt,
    }
  })
}
