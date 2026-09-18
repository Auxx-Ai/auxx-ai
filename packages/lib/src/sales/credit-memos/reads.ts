// packages/lib/src/sales/credit-memos/reads.ts
//
// Reading a credit memo, its lines, its applications and its refunds, and the
// two contact-scoped reads the apply dialog needs. Reads only: the writers are
// `writes.ts`, `apply.ts` and `settle.ts` (`docs/lib-module-guide.md` section 5).
//
// Cells come through `readSystemRecords` (plan §3b), so a relationship is read
// as the record it points at and the per-column guessing is gone. No actor is
// needed, so a preview and a writer share one loader.
//
// No permission checks anywhere in this file. The router asserts (section 6).

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { toCalendarDay } from '@auxx/utils/calendar-day'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { BadRequestError, ConflictError, NotFoundError } from '../../errors'
import { CREDIT_MEMO_APPLICATION_FIELDS } from '../../resources/registry/resources/credit-memo-application-fields'
import { CREDIT_MEMO_FIELDS } from '../../resources/registry/resources/credit-memo-fields'
import { CREDIT_MEMO_LINE_FIELDS } from '../../resources/registry/resources/credit-memo-line-fields'
import { LINE_ITEM_FIELDS } from '../../resources/registry/resources/line-item-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { getInstanceId } from '../../resources/resource-id'
import {
  readSystemRecords,
  type SystemFieldContext,
  type SystemRecord,
  systemFieldMap,
  systemFields,
  systemValueJoin,
} from '../../resources/system-records'
import { isLiveFulfillment } from '../fulfillments/client'
import { readFulfillmentsForOrder } from '../fulfillments/reads'
import type {
  ContactCredit,
  ContactCreditMemo,
  CreditMemoApplicationRow,
  CreditMemoRefundRow,
  CreditMemoSettlement,
  OpenInvoiceRow,
} from './client'

/**
 * Every `credit_memo` attribute one memo's header is assembled from.
 *
 * `credit_memo_lines` is the has_many INVERSE, picked here because this context
 * only ever reads ONE memo and the mirror is where `lineIds` has always come
 * from; {@link CONTACT_CREDIT_ATTRIBUTES} is the set the many-memo reads use so
 * they do not pull a row per line per memo.
 */
const CREDIT_MEMO_ATTRIBUTES = pickSystemAttributes(CREDIT_MEMO_FIELDS, [
  'credit_memo_number',
  'credit_memo_status',
  'credit_memo_source',
  'credit_memo_reason',
  'credit_memo_issued_at',
  'credit_memo_note',
  'credit_memo_contact',
  'credit_memo_invoice',
  'credit_memo_order',
  'credit_memo_subtotal',
  'credit_memo_tax_total',
  'credit_memo_total',
  'credit_memo_amount_applied',
  'credit_memo_amount_refunded',
  'credit_memo_balance',
  'credit_memo_lines',
] as const)

/** The `credit_memo` attributes the contact drawer's credit list and the close gate read. */
const CONTACT_CREDIT_ATTRIBUTES = pickSystemAttributes(CREDIT_MEMO_FIELDS, [
  'credit_memo_number',
  'credit_memo_status',
  'credit_memo_source',
  'credit_memo_issued_at',
  'credit_memo_contact',
  'credit_memo_total',
  'credit_memo_balance',
] as const)

/** Every `credit_memo_line` attribute the module reads. */
const CREDIT_MEMO_LINE_ATTRIBUTES = pickSystemAttributes(CREDIT_MEMO_LINE_FIELDS, [
  'credit_memo_line_description',
  'credit_memo_line_qty',
  'credit_memo_line_unit_price',
  'credit_memo_line_subtotal',
  'credit_memo_line_tax_total',
  'credit_memo_line_disposition',
  'credit_memo_line_line_item',
  'credit_memo_line_sort_order',
] as const)

/** Every `credit_memo_application` attribute the module reads. */
const CREDIT_MEMO_APPLICATION_ATTRIBUTES = pickSystemAttributes(CREDIT_MEMO_APPLICATION_FIELDS, [
  'credit_memo_application_credit_memo',
  'credit_memo_application_invoice',
  'credit_memo_application_amount',
  'credit_memo_application_applied_at',
  'credit_memo_application_operation',
  'credit_memo_application_reverses',
] as const)

/** Every `invoice` attribute the module reads. `invoice-fields.ts` is not a declared map yet, so this one stays hand-written. */
const INVOICE_ATTRIBUTES = [
  'invoice_number',
  'invoice_status',
  'invoice_contact',
  'invoice_issued_at',
  'invoice_due_date',
  'invoice_tax_rate',
  'invoice_subtotal',
  'invoice_tax_total',
  'invoice_total',
  'invoice_amount_paid',
  'invoice_amount_credited',
  'invoice_balance',
  'invoice_line_items',
] as const

/** Every `line_item` attribute `createCreditMemoFromInvoice` copies from. */
const LINE_ITEM_ATTRIBUTES = pickSystemAttributes(LINE_ITEM_FIELDS, [
  'line_item_name',
  'line_item_qty',
  'line_item_unit_price',
  'line_item_line_total',
  'line_item_taxable',
  'line_item_tax_total',
  'line_item_sort_order',
  'line_item_work_order',
] as const)

type CreditMemoApplicationAttribute = (typeof CREDIT_MEMO_APPLICATION_ATTRIBUTES)[number]
type InvoiceAttribute = (typeof INVOICE_ATTRIBUTES)[number]

/** The instance ids a has_many relationship cell points at, in `sortKey` order. */
function relatedIds<A extends string>(record: SystemRecord<A>, attribute: A): string[] {
  return record
    .cells(attribute)
    .map((value) =>
      value.type === 'relationship' && value.recordId ? getInstanceId(value.recordId) : null
    )
    .filter((id): id is string => !!id)
}

// ─── The memo ───────────────────────────────────────────────────────────────

/** One credit memo's header, as every writer in this module reads it. */
export interface CreditMemoRecord {
  id: string
  number: string
  status: string
  source: string
  reason: string | null
  /** `YYYY-MM-DD`, or `null` while a draft has no date. */
  issuedAt: string | null
  note: string | null
  contactInstanceId: string | null
  invoiceInstanceId: string | null
  orderInstanceId: string | null
  /** Integer minor units. `0` when the totals hook has not written yet. */
  subtotalMinor: number
  taxTotalMinor: number
  totalMinor: number
  /** The MIRRORS. `settleCreditMemo` recomputes them from their sources. */
  amountAppliedMinor: number
  amountRefundedMinor: number
  balanceMinor: number
  lineIds: string[]
  /** Whether the org has the `credit_memo_amount_applied` mirror to write at all. */
  hasSettlementFields: boolean
}

/**
 * Read one memo's header, or `null` when it does not exist, is archived, or
 * the org has not seeded the `credit_memo` def.
 */
export async function loadCreditMemo(
  db: Database | Transaction,
  organizationId: string,
  creditMemoId: string
): Promise<CreditMemoRecord | null> {
  const ctx = await systemFields(db, organizationId, 'credit_memo', CREDIT_MEMO_ATTRIBUTES)
  if (!ctx?.fields.credit_memo_status || !ctx.fields.credit_memo_contact) return null

  const [memo] = await readSystemRecords(db, organizationId, ctx, { ids: [creditMemoId] })
  if (!memo) return null

  const status = memo.option('credit_memo_status')
  if (!status) return null

  return {
    id: creditMemoId,
    number: memo.text('credit_memo_number') ?? '',
    status,
    source: memo.option('credit_memo_source') ?? 'native',
    reason: memo.option('credit_memo_reason'),
    issuedAt: toCalendarDay(memo.date('credit_memo_issued_at')),
    note: memo.text('credit_memo_note'),
    contactInstanceId: memo.related('credit_memo_contact'),
    invoiceInstanceId: memo.related('credit_memo_invoice'),
    orderInstanceId: memo.related('credit_memo_order'),
    subtotalMinor: memo.number('credit_memo_subtotal') ?? 0,
    taxTotalMinor: memo.number('credit_memo_tax_total') ?? 0,
    totalMinor: memo.number('credit_memo_total') ?? 0,
    amountAppliedMinor: memo.number('credit_memo_amount_applied') ?? 0,
    amountRefundedMinor: memo.number('credit_memo_amount_refunded') ?? 0,
    balanceMinor: memo.number('credit_memo_balance') ?? 0,
    lineIds: relatedIds(memo, 'credit_memo_lines'),
    hasSettlementFields: ctx.fields.credit_memo_amount_applied !== null,
  }
}

/** {@link loadCreditMemo}, as the refusal a writer needs. */
export async function requireCreditMemo(
  db: Database | Transaction,
  organizationId: string,
  creditMemoId: string
): Promise<CreditMemoRecord> {
  const memo = await loadCreditMemo(db, organizationId, creditMemoId)
  if (!memo) throw new NotFoundError('Credit memo not found', { creditMemoId })
  return memo
}

/** One `credit_memo_line`, as the issue validation and the PDF read it. */
export interface CreditMemoLineRecord {
  id: string
  description: string | null
  qty: number
  /** Integer minor units, or `null` for an unpriced line. */
  unitPriceMinor: number | null
  subtotalMinor: number
  /** Integer minor units. `null` is not zero: no tax was supplied for the line. */
  taxTotalMinor: number | null
  disposition: string | null
  lineItemInstanceId: string | null
  sortOrder: number
}

/** The memo's lines, in display order. */
export async function loadCreditMemoLines(
  db: Database | Transaction,
  organizationId: string,
  lineIds: readonly string[]
): Promise<CreditMemoLineRecord[]> {
  if (lineIds.length === 0) return []
  const ctx = await systemFields(
    db,
    organizationId,
    'credit_memo_line',
    CREDIT_MEMO_LINE_ATTRIBUTES
  )
  if (!ctx) return []

  const records = await readSystemRecords(db, organizationId, ctx, { ids: lineIds })
  const byId = new Map(records.map((record) => [record.id, record]))

  // Walked in the order the memo named them, not the reader's `createdAt` order:
  // the position is the fallback when a line carries no `sortOrder`.
  return lineIds
    .map((lineId) => byId.get(lineId))
    .filter((line) => line !== undefined)
    .map((line, index) => ({
      id: line.id,
      description: line.text('credit_memo_line_description'),
      qty: line.number('credit_memo_line_qty') ?? 0,
      unitPriceMinor: line.number('credit_memo_line_unit_price'),
      subtotalMinor: line.number('credit_memo_line_subtotal') ?? 0,
      taxTotalMinor: line.number('credit_memo_line_tax_total'),
      disposition: line.option('credit_memo_line_disposition'),
      lineItemInstanceId: line.related('credit_memo_line_line_item'),
      sortOrder: line.number('credit_memo_line_sort_order') ?? index,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

// ─── Applications ───────────────────────────────────────────────────────────

/** One `credit_memo_application`, as the settlement and the un-apply read it. */
export interface CreditMemoApplicationRecord {
  operation: 'apply' | 'unapply'
  reversesApplicationId: string | null
  id: string
  creditMemoInstanceId: string | null
  invoiceInstanceId: string | null
  /** Integer minor units. */
  amountMinor: number
  /** ISO instant, or `null`. */
  appliedAt: string | null
}

async function applicationContext(
  db: Database | Transaction,
  organizationId: string
): Promise<SystemFieldContext<CreditMemoApplicationAttribute> | null> {
  return systemFields(
    db,
    organizationId,
    'credit_memo_application',
    CREDIT_MEMO_APPLICATION_ATTRIBUTES
  )
}

function applicationFrom(
  record: SystemRecord<CreditMemoApplicationAttribute>
): CreditMemoApplicationRecord {
  return {
    id: record.id,
    creditMemoInstanceId: record.related('credit_memo_application_credit_memo'),
    invoiceInstanceId: record.related('credit_memo_application_invoice'),
    operation: record.text('credit_memo_application_operation') === 'unapply' ? 'unapply' : 'apply',
    reversesApplicationId: record.related('credit_memo_application_reverses'),
    amountMinor: record.number('credit_memo_application_amount') ?? 0,
    appliedAt: record.date('credit_memo_application_applied_at'),
  }
}

/**
 * Every application of one memo, oldest first. Read off the owning side
 * (`credit_memo_application_credit_memo`), never off the memo's mirrored
 * has_many, so a stale inverse row can neither hide nor invent an application.
 */
export async function listCreditMemoApplications(
  db: Database | Transaction,
  organizationId: string,
  creditMemoId: string
): Promise<CreditMemoApplicationRecord[]> {
  const ctx = await applicationContext(db, organizationId)
  if (!ctx) return []
  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'credit_memo_application_credit_memo', in: [creditMemoId] },
  })
  return records.map(applicationFrom)
}

/** One application by id, or `null`. */
export async function loadCreditMemoApplication(
  db: Database | Transaction,
  organizationId: string,
  applicationId: string
): Promise<CreditMemoApplicationRecord | null> {
  const ctx = await applicationContext(db, organizationId)
  if (!ctx) return null
  const [record] = await readSystemRecords(db, organizationId, ctx, { ids: [applicationId] })
  return record ? applicationFrom(record) : null
}

/**
 * Integer minor units: what has been applied TO this invoice across every memo,
 * summed from the rows. `applyCreditMemo` refuses on this rather than on the
 * `invoice_amount_credited` mirror, which `syncInvoicePaymentState` rewrites
 * only when it is next run.
 */
export async function sumInvoiceCreditApplications(
  db: Database | Transaction,
  organizationId: string,
  invoiceId: string
): Promise<number> {
  const ctx = await applicationContext(db, organizationId)
  if (!ctx) return 0
  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'credit_memo_application_invoice', in: [invoiceId] },
  })
  const rows = records.map(applicationFrom)
  return rows.reduce(
    (sum, row) => sum + (row.operation === 'unapply' ? -row.amountMinor : row.amountMinor),
    0
  )
}

/** Integer minor units: what has been applied off this memo, summed from the rows. */
export async function sumCreditMemoApplications(
  db: Database | Transaction,
  organizationId: string,
  creditMemoId: string
): Promise<number> {
  const rows = await listCreditMemoApplications(db, organizationId, creditMemoId)
  return rows.reduce(
    (sum, row) => sum + (row.operation === 'unapply' ? -row.amountMinor : row.amountMinor),
    0
  )
}

/** Credit consumed by confirmed or in-flight refunds. Called while holding the shared money lock. */
export async function sumReservedCreditMemoRefunds(
  db: Database | Transaction,
  organizationId: string,
  memo: Pick<CreditMemoRecord, 'id' | 'source' | 'amountRefundedMinor'>
): Promise<number> {
  const refunds = await listCreditMemoRefunds(db, organizationId, memo.id)
  const canonical = refunds
    .filter((row) => row.origin === 'money')
    .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n)
  const native = refunds
    .filter(
      (row) =>
        row.origin === 'payment_transaction' &&
        ['pending', 'processing', 'succeeded'].includes(row.status)
    )
    .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n)
  // A channel memo's transcribed figure and the canonical movements can
  // describe the same refunds, so the larger stands rather than their sum; the
  // legacy rail is a separate movement and adds.
  const imported = memo.source === 'channel' ? BigInt(memo.amountRefundedMinor) : 0n
  const reserved = (canonical > imported ? canonical : imported) + native
  if (reserved > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ConflictError('Credit refund balance exceeds the supported amount range')
  return Number(reserved)
}

// ─── Refunds ────────────────────────────────────────────────────────────────

/**
 * Every refund carrying this memo, oldest first, whatever its status - both
 * rails in one list.
 *
 * 🛑 `MoneyRefundSettlement` is the only rail. `readAdoptedLegacyRefundIds`
 * still guards against re-counting a HISTORICAL legacy refund an evidence
 * record already adopted into a money movement.
 */
export async function listCreditMemoRefunds(
  db: Database | Transaction,
  organizationId: string,
  creditMemoId: string
): Promise<CreditMemoRefundRow[]> {
  const settlements = await db.query.MoneyRefundSettlement.findMany({
    where: and(
      eq(schema.MoneyRefundSettlement.organizationId, organizationId),
      eq(schema.MoneyRefundSettlement.customerCreditMemoInstanceId, creditMemoId)
    ),
  })
  const money = settlements.length
    ? await db.query.MoneyTransaction.findMany({
        where: and(
          eq(schema.MoneyTransaction.organizationId, organizationId),
          inArray(
            schema.MoneyTransaction.id,
            settlements.map((row) => row.refundTransactionId)
          )
        ),
      })
    : []
  const moneyById = new Map(money.map((row) => [row.id, row]))
  const rows: CreditMemoRefundRow[] = []
  for (const row of settlements) {
    const movement = moneyById.get(row.refundTransactionId)
    if (!movement) continue
    rows.push({
      transactionId: movement.id,
      origin: 'money',
      provider: 'manual',
      // A `MoneyTransaction` IS the confirmed movement - there is no pending
      // state to project, unlike a provider-held `PaymentTransaction`.
      status: 'succeeded',
      amountMinor: Number(row.amountMinor),
      method: movement.method ?? null,
      reference: movement.reference ?? null,
      createdAt: movement.createdAt.toISOString(),
    })
  }
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Integer minor units: the `succeeded` refunds carrying this memo, summed. */
export async function sumSucceededCreditMemoRefunds(
  db: Database | Transaction,
  organizationId: string,
  creditMemoId: string
): Promise<number> {
  const rows = await listCreditMemoRefunds(db, organizationId, creditMemoId)
  return rows
    .filter((row) => row.status === 'succeeded')
    .reduce((sum, row) => sum + row.amountMinor, 0)
}

// ─── The invoice ────────────────────────────────────────────────────────────

/** One invoice's header, as `createCreditMemoFromInvoice` and `applyCreditMemo` read it. */
export interface InvoiceForCredit {
  id: string
  number: string
  status: string
  contactInstanceId: string | null
  issuedAt: string | null
  dueDate: string | null
  /** Percent, or `null` when the invoice states no rate. */
  taxRate: number | null
  /** Integer minor units. `0` when never written. */
  subtotalMinor: number
  taxTotalMinor: number
  totalMinor: number
  amountPaidMinor: number
  amountCreditedMinor: number
  /** The mirrored `invoice_balance`. See {@link resolveInvoiceOutstandingMinor}. */
  balanceMinor: number
  lineIds: string[]
}

/**
 * What the invoice still owes: `total - paid - credited`, derived rather than
 * read off `invoice_balance`, for the reason `write-off.ts` derives its own
 * figure: the mirror is a projection written by another function, and the
 * refusal "this application exceeds the invoice balance" must not depend on
 * that projection having run since the last event.
 */
export function resolveInvoiceOutstandingMinor(invoice: InvoiceForCredit): number {
  if (invoice.totalMinor > 0) {
    return Math.max(0, invoice.totalMinor - invoice.amountPaidMinor - invoice.amountCreditedMinor)
  }
  return Math.max(0, invoice.balanceMinor)
}

function invoiceContext(
  db: Database | Transaction,
  organizationId: string
): Promise<SystemFieldContext<InvoiceAttribute> | null> {
  return systemFields(db, organizationId, 'invoice', INVOICE_ATTRIBUTES)
}

function invoiceFrom(record: SystemRecord<InvoiceAttribute>): InvoiceForCredit | null {
  const status = record.option('invoice_status')
  if (!status) return null
  return {
    id: record.id,
    number: record.text('invoice_number') ?? '',
    status,
    contactInstanceId: record.related('invoice_contact'),
    issuedAt: toCalendarDay(record.date('invoice_issued_at')),
    dueDate: toCalendarDay(record.date('invoice_due_date')),
    taxRate: record.number('invoice_tax_rate'),
    subtotalMinor: record.number('invoice_subtotal') ?? 0,
    taxTotalMinor: record.number('invoice_tax_total') ?? 0,
    totalMinor: record.number('invoice_total') ?? 0,
    amountPaidMinor: record.number('invoice_amount_paid') ?? 0,
    amountCreditedMinor: record.number('invoice_amount_credited') ?? 0,
    balanceMinor: record.number('invoice_balance') ?? 0,
    lineIds: relatedIds(record, 'invoice_line_items'),
  }
}

/** One invoice's header, or `null`. */
export async function loadInvoiceForCredit(
  db: Database | Transaction,
  organizationId: string,
  invoiceId: string
): Promise<InvoiceForCredit | null> {
  const ctx = await invoiceContext(db, organizationId)
  if (!ctx?.fields.invoice_status) return null
  const [record] = await readSystemRecords(db, organizationId, ctx, { ids: [invoiceId] })
  return record ? invoiceFrom(record) : null
}

/** One invoice line, as `createCreditMemoFromInvoice` copies it. */
export interface InvoiceLineForCredit {
  id: string
  name: string
  qty: number
  /** Integer minor units, or `null` for an unpriced line. */
  unitPriceMinor: number | null
  /** Integer minor units, or `null` for an unpriced line. */
  lineTotalMinor: number | null
  taxable: boolean
  /** Integer minor units. `null` when no per-line tax was supplied. */
  taxTotalMinor: number | null
  sortOrder: number
}

/**
 * The invoice's OWN lines, in display order.
 *
 * A work-order source line stamped with `line_item_invoice` is excluded, the
 * same invariant the totals engine applies (`money/totals-hooks.ts`, the
 * `invoice-lines-workorder` condition): an invoice's own copies never carry a
 * work order, and a source line must not be credited twice.
 */
export async function loadInvoiceLinesForCredit(
  db: Database,
  organizationId: string,
  lineIds: readonly string[]
): Promise<InvoiceLineForCredit[]> {
  if (lineIds.length === 0) return []
  const ctx = await systemFields(db, organizationId, 'line_item', LINE_ITEM_ATTRIBUTES)
  if (!ctx) return []
  const records = await readSystemRecords(db, organizationId, ctx, { ids: lineIds })
  const byId = new Map(records.map((record) => [record.id, record]))

  return lineIds
    .map((lineId) => byId.get(lineId))
    .filter((line) => line !== undefined)
    .flatMap((line, index) => {
      if (line.related('line_item_work_order')) return []
      const taxable = line.boolean('line_item_taxable')
      return [
        {
          id: line.id,
          name: line.text('line_item_name') ?? 'Line item',
          qty: line.number('line_item_qty') ?? 0,
          unitPriceMinor: line.number('line_item_unit_price'),
          lineTotalMinor: line.number('line_item_line_total'),
          // An absent row is taxable, the default the totals engine applies.
          taxable: taxable == null ? true : taxable,
          taxTotalMinor: line.number('line_item_tax_total'),
          sortOrder: line.number('line_item_sort_order') ?? index,
        },
      ]
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

// ─── The order ──────────────────────────────────────────────────────────────

/**
 * Every gateway `order_payment_gateways` holds for one order, raw.
 *
 * 🛑 Read for the REFUND's account, not the sale's. `issueCreditMemo` matches
 * these against the org's `payment_gateway` records so a channel refund credits
 * the account its sale debited - see `CreditMemoSettlement`. Before 2026-09-11
 * the refund was hardcoded to `clearing`, which was correct only while
 * every rail shared one clearing account.
 *
 * ⚠️ **TAGS, so the value is in `optionId`**, not `valueText` - one row per
 * gateway, each an option KEY that for a connector-provisioned option set IS
 * the gateway's name (`readOrderFacts` says the same). Reading `valueText`
 * here returns nothing at all and every refund falls back to the role, which
 * is the silent version of the bug this read exists to fix.
 *
 * Empty when the field is unprovisioned or the order names no gateway: the
 * caller then takes the `clearing` default, which is what the fulfillment
 * debit fork does with the same input.
 */
export async function readOrderGateways(
  db: Database,
  organizationId: string,
  orderId: string
): Promise<string[]> {
  // One attribute of one known order: `readSystemRecords` would cost a second
  // `EntityInstance` query for the same two columns.
  const fields = await systemFieldMap(db, organizationId, ['order_payment_gateways'] as const)
  const field = fields.order_payment_gateways
  if (!field) return []

  const rows = await db
    .select({ optionId: schema.FieldValue.optionId, valueText: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, orderId),
        eq(schema.FieldValue.fieldId, field.id)
      )
    )

  return rows.flatMap((row) => {
    const value = row.optionId ?? row.valueText
    return value ? [value] : []
  })
}

/**
 * Whether the order had a fulfillment shipped on or before `issuedAt`.
 *
 * Read from the order's `fulfillment` records (`money/fulfillments/reads.ts`),
 * never from `order_fulfillment_status`: the status says `partial` and cannot
 * say WHEN. A channel memo on an order with no shipment before its date
 * reverses revenue that was never posted, so the issue entry omits the
 * revenue leg (section 3.1).
 *
 * 🛑 Only LIVE fulfillments count (`isLiveFulfillment`, i.e. not `cancelled`).
 * This is not new behaviour: the JSON log this replaces never carried a
 * cancelled dispatch either - the connector's `deriveFulfillments` filtered
 * `status !== 'cancelled'` before anything reached the log. The record form
 * keeps cancelled dispatches (brief 55 §5), so this function has to exclude
 * them itself to preserve the original meaning of "shipped": a cancelled
 * fulfillment did not ship, and must not be read as evidence that revenue was
 * ever recognised for it.
 */
export async function orderHadFulfillmentBefore(
  db: Database,
  organizationId: string,
  orderId: string,
  issuedAt: string
): Promise<boolean> {
  const fulfillments = await readFulfillmentsForOrder(db, { organizationId, orderId })
  return fulfillments.some((fulfillment) => {
    if (!isLiveFulfillment(fulfillment)) return false
    const shippedDay = toCalendarDay(fulfillment.shippedAt)
    return shippedDay !== null && shippedDay <= issuedAt
  })
}

// ─── The reads the router exposes ───────────────────────────────────────────

/**
 * The four settlement figures and the rows behind two of them, for the
 * settlement card. The figures are SUMMED FROM THEIR SOURCES here rather than
 * read off the mirrors, so the card can never show a balance the next settle
 * would move.
 */
export async function readCreditMemoSettlement(
  db: Database,
  params: { organizationId: string; creditMemoInstanceId: string }
): Promise<CreditMemoSettlement> {
  const { organizationId, creditMemoInstanceId } = params
  const memo = await requireCreditMemo(db, organizationId, creditMemoInstanceId)
  const [applications, refunds] = await Promise.all([
    listCreditMemoApplications(db, organizationId, creditMemoInstanceId),
    listCreditMemoRefunds(db, organizationId, creditMemoInstanceId),
  ])

  const invoiceIds = [
    ...new Set(applications.map((row) => row.invoiceInstanceId).filter((id): id is string => !!id)),
  ]
  const invoiceNumbers = new Map<string, string>()
  if (invoiceIds.length > 0) {
    // The number alone, not the whole `INVOICE_ATTRIBUTES` slice: this is a label.
    const ctx = await systemFields(db, organizationId, 'invoice', ['invoice_number'] as const)
    if (ctx?.fields.invoice_number) {
      for (const record of await readSystemRecords(db, organizationId, ctx, { ids: invoiceIds })) {
        invoiceNumbers.set(record.id, record.text('invoice_number') ?? '')
      }
    }
  }

  const amountAppliedMinor = applications.reduce(
    (sum, row) => sum + (row.operation === 'unapply' ? -row.amountMinor : row.amountMinor),
    0
  )
  // A channel memo's refunded figure is transcribed by the connector; only a
  // native memo's is summed from the ledger (section 2.1).
  const amountRefundedMinor =
    memo.source === 'channel'
      ? memo.amountRefundedMinor
      : refunds
          .filter((row) => row.status === 'succeeded')
          .reduce((sum, row) => sum + row.amountMinor, 0)

  const applicationRows: CreditMemoApplicationRow[] = applications.map((row) => ({
    applicationInstanceId: row.id,
    operation: row.operation,
    reversed: applications.some((other) => other.reversesApplicationId === row.id),
    invoiceInstanceId: row.invoiceInstanceId ?? '',
    invoiceNumber: row.invoiceInstanceId ? (invoiceNumbers.get(row.invoiceInstanceId) ?? '') : '',
    amountMinor: row.amountMinor,
    appliedAt: row.appliedAt,
  }))

  return {
    creditMemoInstanceId,
    number: memo.number,
    status: memo.status,
    source: memo.source,
    contactInstanceId: memo.contactInstanceId,
    invoiceInstanceId: memo.invoiceInstanceId,
    totalMinor: memo.totalMinor,
    amountAppliedMinor,
    amountRefundedMinor,
    balanceMinor: Math.max(0, memo.totalMinor - amountAppliedMinor - amountRefundedMinor),
    applications: applicationRows,
    refunds,
  }
}

/**
 * The credit a contact can still draw on: every `issued` memo of theirs with a
 * balance, oldest issued first, and the sum. `settled` memos have no balance
 * and `draft`/`void` ones are not credit, so only `issued` counts.
 *
 * The balance is the MIRROR here, deliberately. This read backs a figure on the
 * contact drawer and a prefill in the payment dialog, and `settleCreditMemo`
 * rewrites the mirror on every application and refund, so re-summing every
 * memo's applications for one contact would cost a query per memo for the same
 * answer. `applyCreditMemo` re-derives before it refuses.
 */
export async function readContactCredit(
  db: Database,
  params: { organizationId: string; contactInstanceId: string }
): Promise<ContactCredit> {
  const { organizationId, contactInstanceId } = params
  const ctx = await systemFields(db, organizationId, 'credit_memo', CONTACT_CREDIT_ATTRIBUTES)
  if (!ctx) return { contactInstanceId, creditAvailableMinor: 0, memos: [] }

  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'credit_memo_contact', in: [contactInstanceId] },
  })

  const memos: ContactCreditMemo[] = []
  for (const record of records) {
    if (record.option('credit_memo_status') !== 'issued') continue
    const balanceMinor = record.number('credit_memo_balance') ?? 0
    if (balanceMinor <= 0) continue
    memos.push({
      creditMemoInstanceId: record.id,
      number: record.text('credit_memo_number') ?? '',
      issuedAt: toCalendarDay(record.date('credit_memo_issued_at')),
      totalMinor: record.number('credit_memo_total') ?? 0,
      balanceMinor,
    })
  }
  memos.sort((a, b) => (a.issuedAt ?? '').localeCompare(b.issuedAt ?? ''))

  return {
    contactInstanceId,
    creditAvailableMinor: memos.reduce((sum, memo) => sum + memo.balanceMinor, 0),
    memos,
  }
}

/** The invoice statuses that still owe something. */
const OPEN_INVOICE_STATUSES: ReadonlySet<string> = new Set(['sent', 'partially_paid'])

/**
 * The contact's invoices that credit can be applied to: `sent` or
 * `partially_paid` with something still outstanding, oldest issued first.
 * The apply dialog's picker.
 */
export async function listOpenInvoicesForContact(
  db: Database,
  params: { organizationId: string; contactInstanceId: string }
): Promise<OpenInvoiceRow[]> {
  const { organizationId, contactInstanceId } = params
  const ctx = await invoiceContext(db, organizationId)
  if (!ctx?.fields.invoice_status) return []

  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'invoice_contact', in: [contactInstanceId] },
  })

  const rows: OpenInvoiceRow[] = []
  for (const record of records) {
    const invoice = invoiceFrom(record)
    if (!invoice || !OPEN_INVOICE_STATUSES.has(invoice.status)) continue
    const balanceMinor = resolveInvoiceOutstandingMinor(invoice)
    if (balanceMinor <= 0) continue
    rows.push({
      invoiceInstanceId: record.id,
      number: invoice.number,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      totalMinor: invoice.totalMinor,
      balanceMinor,
    })
  }
  return rows.sort((a, b) => (a.issuedAt ?? '').localeCompare(b.issuedAt ?? ''))
}

// ─── The close gate ─────────────────────────────────────────────────────────

/**
 * How many `channel` credit memos are still DRAFT with an issue date in one
 * month (10 §3.4, 49 §8.4 decision 7).
 *
 * 🛑 This is the count the month-end close refuses on, and it exists because a
 * channel draft sitting in a month being closed is revenue still on the P&L. A
 * connector ingested a refund, nobody issued it, and closing the month declares
 * a set of books that does not contain it. Rolling it into the next period
 * instead would post an entry dated inside a locked month, which `period-lock.ts`
 * exists to refuse - so blocking is the only remedy that neither posts something
 * nobody looked at nor writes into a closed period.
 *
 * ⚠️ NATIVE drafts are deliberately not counted. Nothing was ingested and nobody
 * is waiting: a half-typed credit memo is a person's scratch pad, not revenue
 * the books are missing.
 *
 * The month is matched by SLICING `credit_memo_issued_at`, never by re-zoning
 * it - the rule the whole of this file and `money/invoices/post-invoice.ts`
 * follow for an accounting date. The issue date IS the calendar day the entry
 * would post on, so the refusal and the posting it prevents read the date
 * identically; deriving a book-zone month here and a sliced day there would let
 * the close block a memo that would post into a different month.
 *
 * The status and source filters run in SQL over an indexed `(organizationId,
 * fieldId)` pair, so the rows that reach TypeScript are the org's unissued
 * channel drafts - a set that is empty in the steady state and is a work queue
 * when it is not.
 *
 * @param db The database handle. Reads only.
 * @param params The organization and the accounting MONTH, `'2026-07'`.
 * @returns The count. `0` when the org has not seeded the `credit_memo` def.
 */
export async function countUnissuedChannelCreditMemos(
  db: Database,
  params: { organizationId: string; month: string }
): Promise<number> {
  const { organizationId, month } = params

  const fields = await systemFieldMap(db, organizationId, CONTACT_CREDIT_ATTRIBUTES)

  const statusField = fields.credit_memo_status
  const sourceField = fields.credit_memo_source
  const issuedAtField = fields.credit_memo_issued_at
  if (!statusField || !sourceField || !issuedAtField) return 0

  const source = alias(schema.FieldValue, 'cm_source')
  const issuedAt = alias(schema.FieldValue, 'cm_issued_at')

  const rows = await db
    .select({ valueDate: issuedAt.valueDate })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .innerJoin(source, systemValueJoin(source, sourceField.id))
    .innerJoin(issuedAt, systemValueJoin(issuedAt, issuedAtField.id))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, statusField.id),
        eq(schema.FieldValue.optionId, 'draft'),
        eq(source.optionId, 'channel')
      )
    )

  let count = 0
  for (const row of rows) {
    if (toCalendarDay(row.valueDate)?.startsWith(`${month}-`)) count += 1
  }
  return count
}

/** What a refund rail needs to know about the memo it settles. */
export interface CreditMemoForRefund {
  status: string
  /** Integer minor units, `credit_memo_balance` as `settleCreditMemo` last wrote it. */
  balance: number
  contactInstanceId: string | null
  invoiceInstanceId: string | null
}

/**
 * Read the memo a refund is about to settle and refuse what neither rail may do
 * (plans/accounting/tasks/done/10-credit-memos.md §2.4, §5.3): a memo that is not
 * `issued` has nothing to give back (`draft` is unposted, `settled` has a zero
 * balance, `void` was reversed), and a refund may not exceed the balance the
 * settlement writer last derived. Shared by `recordManualRefund` and the Stripe
 * rail's `refundTransaction` so the two rails cannot disagree on what a
 * refundable memo is. Throws `NotFoundError` when the memo does not resolve.
 */
export async function readCreditMemoForRefund(params: {
  organizationId: string
  userId: string
  creditMemoInstanceId: string
  amount: number
  db?: Database
}): Promise<CreditMemoForRefund> {
  const { organizationId, creditMemoInstanceId, amount } = params
  const db = params.db ?? database
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new BadRequestError('Refund amount must be a whole number of minor units above zero')
  const memo = await requireCreditMemo(db, organizationId, creditMemoInstanceId)
  if (memo.status !== 'issued')
    throw new BadRequestError(`Cannot refund a credit memo in status '${memo.status}'`)
  const [applied, reserved] = await Promise.all([
    sumCreditMemoApplications(db, organizationId, creditMemoInstanceId),
    sumReservedCreditMemoRefunds(db, organizationId, memo),
  ])
  const balance = memo.totalMinor - applied - reserved
  if (amount > balance)
    throw new BadRequestError(`Refund amount exceeds the credit memo balance of ${balance}`)
  return {
    status: memo.status,
    balance,
    contactInstanceId: memo.contactInstanceId,
    invoiceInstanceId: memo.invoiceInstanceId,
  }
}
