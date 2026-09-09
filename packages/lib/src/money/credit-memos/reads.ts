// packages/lib/src/money/credit-memos/reads.ts
//
// Reading a credit memo, its lines, its applications and its refunds, and the
// two contact-scoped reads the apply dialog needs. Reads only: the writers are
// `writes.ts`, `apply.ts` and `settle.ts` (`docs/lib-module-guide.md` section 5).
//
// Values are read off `FieldValue`'s own columns rather than through
// `UnifiedCrudHandler.getFieldValues`, the trade `money/invoices/write-off.ts`
// and `money/orders/reads.ts` make: no actor is needed, so a preview and a
// writer share one loader, and a relationship's `relatedEntityId` is read as the
// id it is rather than unwrapped from a typed envelope.
//
// No permission checks anywhere in this file. The router asserts (section 6).

import { type Database, schema } from '@auxx/database'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getOrgCache } from '../../cache'
import { NotFoundError } from '../../errors'
import { parseFulfillments } from '../orders/reads'
import type {
  ContactCredit,
  ContactCreditMemo,
  CreditMemoApplicationRow,
  CreditMemoRefundRow,
  CreditMemoSettlement,
  OpenInvoiceRow,
} from './client'

/** Every `credit_memo` attribute the module reads. */
const CREDIT_MEMO_ATTRIBUTES = [
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
] as const

/** Every `credit_memo_line` attribute the module reads. */
const CREDIT_MEMO_LINE_ATTRIBUTES = [
  'credit_memo_line_description',
  'credit_memo_line_qty',
  'credit_memo_line_unit_price',
  'credit_memo_line_subtotal',
  'credit_memo_line_tax_total',
  'credit_memo_line_disposition',
  'credit_memo_line_line_item',
  'credit_memo_line_sort_order',
] as const

/** Every `credit_memo_application` attribute the module reads. */
const CREDIT_MEMO_APPLICATION_ATTRIBUTES = [
  'credit_memo_application_credit_memo',
  'credit_memo_application_invoice',
  'credit_memo_application_amount',
  'credit_memo_application_applied_at',
] as const

/** Every `invoice` attribute the module reads. */
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
const LINE_ITEM_ATTRIBUTES = [
  'line_item_name',
  'line_item_qty',
  'line_item_unit_price',
  'line_item_line_total',
  'line_item_taxable',
  'line_item_tax_total',
  'line_item_sort_order',
  'line_item_work_order',
] as const

type CreditMemoAttribute = (typeof CREDIT_MEMO_ATTRIBUTES)[number]
type CreditMemoLineAttribute = (typeof CREDIT_MEMO_LINE_ATTRIBUTES)[number]
type CreditMemoApplicationAttribute = (typeof CREDIT_MEMO_APPLICATION_ATTRIBUTES)[number]
type InvoiceAttribute = (typeof INVOICE_ATTRIBUTES)[number]
type LineItemAttribute = (typeof LINE_ITEM_ATTRIBUTES)[number]

type FieldMap<A extends string> = Record<A, { id: string } | null>

/** One `FieldValue` row, in the columns this module reads. */
interface ValueRow {
  entityId: string
  fieldId: string
  valueText: string | null
  valueNumber: number | null
  valueBoolean: boolean | null
  valueDate: string | null
  optionId: string | null
  relatedEntityId: string | null
}

/**
 * `FieldValue` rows for a set of instances and fields, bucketed
 * `instance -> field -> rows`. The inner value is an ARRAY because a has_many
 * field has one row per related record.
 */
async function selectValues(
  db: Database,
  organizationId: string,
  entityIds: readonly string[],
  fieldIds: readonly string[]
): Promise<Map<string, Map<string, ValueRow[]>>> {
  const buckets = new Map<string, Map<string, ValueRow[]>>()
  if (entityIds.length === 0 || fieldIds.length === 0) return buckets

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueBoolean: schema.FieldValue.valueBoolean,
      valueDate: schema.FieldValue.valueDate,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, [...entityIds]),
        inArray(schema.FieldValue.fieldId, [...fieldIds])
      )
    )
    .orderBy(schema.FieldValue.sortKey)

  for (const row of rows) {
    let byField = buckets.get(row.entityId)
    if (!byField) {
      byField = new Map()
      buckets.set(row.entityId, byField)
    }
    const list = byField.get(row.fieldId)
    if (list) list.push(row)
    else byField.set(row.fieldId, [row])
  }
  return buckets
}

/** The field ids of a resolved attribute map, dropping the ones the org lacks. */
function fieldIdsOf<A extends string>(fields: FieldMap<A>): string[] {
  return Object.values<{ id: string } | null>(fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)
}

/** A cell reader bound to one instance's bucket and one attribute map. */
function cellReader<A extends string>(
  fields: FieldMap<A>,
  bucket: Map<string, ValueRow[]> | undefined
): {
  cell: (attribute: A) => ValueRow | undefined
  cells: (attribute: A) => ValueRow[]
} {
  return {
    cell: (attribute) => {
      const field = fields[attribute]
      return field ? bucket?.get(field.id)?.[0] : undefined
    },
    cells: (attribute) => {
      const field = fields[attribute]
      return field ? (bucket?.get(field.id) ?? []) : []
    },
  }
}

/**
 * `FieldValue.valueDate` arrives as an ISO instant. The accounting date is the
 * calendar day, so it is sliced, never re-zoned - the rule
 * `money/invoices/post-invoice.ts` follows for `invoice_issued_at`.
 */
function toCalendarDay(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && raw.length >= 10 ? raw.slice(0, 10) : null
}

/** The ids of every non-archived instance among `ids`, in the order given. */
async function liveInstanceIds(
  db: Database,
  organizationId: string,
  ids: readonly string[]
): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, [...ids]),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  const live = new Set(rows.map((row) => row.id))
  return ids.filter((id) => live.has(id))
}

/**
 * The owning-side rows of one belongs_to field that point at `targetId`: every
 * child whose `<child>_<parent>` relationship is this record. The one query
 * shape behind "the memos of a contact", "the applications of a memo" and "the
 * invoices of a contact".
 */
async function childIdsPointingAt(
  db: Database,
  organizationId: string,
  field: { id: string } | null,
  targetId: string
): Promise<string[]> {
  if (!field) return []
  const rows = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, field.id),
        eq(schema.FieldValue.relatedEntityId, targetId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .orderBy(asc(schema.EntityInstance.createdAt))
  return [...new Set(rows.map((row) => row.entityId))]
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
  db: Database,
  organizationId: string,
  creditMemoId: string
): Promise<CreditMemoRecord | null> {
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...CREDIT_MEMO_ATTRIBUTES])) as FieldMap<CreditMemoAttribute>
  if (!fields.credit_memo_status || !fields.credit_memo_contact) return null

  const [instance] = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, creditMemoId),
        eq(schema.EntityInstance.organizationId, organizationId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  if (!instance) return null

  const buckets = await selectValues(db, organizationId, [creditMemoId], fieldIdsOf(fields))
  const { cell, cells } = cellReader(fields, buckets.get(creditMemoId))

  const status = cell('credit_memo_status')?.optionId
  if (!status) return null

  return {
    id: creditMemoId,
    number: cell('credit_memo_number')?.valueText ?? '',
    status,
    source: cell('credit_memo_source')?.optionId ?? 'native',
    reason: cell('credit_memo_reason')?.optionId ?? null,
    issuedAt: toCalendarDay(cell('credit_memo_issued_at')?.valueDate),
    note: cell('credit_memo_note')?.valueText ?? null,
    contactInstanceId: cell('credit_memo_contact')?.relatedEntityId ?? null,
    invoiceInstanceId: cell('credit_memo_invoice')?.relatedEntityId ?? null,
    orderInstanceId: cell('credit_memo_order')?.relatedEntityId ?? null,
    subtotalMinor: cell('credit_memo_subtotal')?.valueNumber ?? 0,
    taxTotalMinor: cell('credit_memo_tax_total')?.valueNumber ?? 0,
    totalMinor: cell('credit_memo_total')?.valueNumber ?? 0,
    amountAppliedMinor: cell('credit_memo_amount_applied')?.valueNumber ?? 0,
    amountRefundedMinor: cell('credit_memo_amount_refunded')?.valueNumber ?? 0,
    balanceMinor: cell('credit_memo_balance')?.valueNumber ?? 0,
    lineIds: cells('credit_memo_lines')
      .map((row) => row.relatedEntityId)
      .filter((id): id is string => !!id),
    hasSettlementFields: fields.credit_memo_amount_applied !== null,
  }
}

/** {@link loadCreditMemo}, as the refusal a writer needs. */
export async function requireCreditMemo(
  db: Database,
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
  db: Database,
  organizationId: string,
  lineIds: readonly string[]
): Promise<CreditMemoLineRecord[]> {
  if (lineIds.length === 0) return []
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...CREDIT_MEMO_LINE_ATTRIBUTES])) as FieldMap<CreditMemoLineAttribute>

  const live = await liveInstanceIds(db, organizationId, lineIds)
  const buckets = await selectValues(db, organizationId, live, fieldIdsOf(fields))

  return live
    .map((lineId, index) => {
      const { cell } = cellReader(fields, buckets.get(lineId))
      return {
        id: lineId,
        description: cell('credit_memo_line_description')?.valueText ?? null,
        qty: cell('credit_memo_line_qty')?.valueNumber ?? 0,
        unitPriceMinor: cell('credit_memo_line_unit_price')?.valueNumber ?? null,
        subtotalMinor: cell('credit_memo_line_subtotal')?.valueNumber ?? 0,
        taxTotalMinor: cell('credit_memo_line_tax_total')?.valueNumber ?? null,
        disposition: cell('credit_memo_line_disposition')?.optionId ?? null,
        lineItemInstanceId: cell('credit_memo_line_line_item')?.relatedEntityId ?? null,
        sortOrder: cell('credit_memo_line_sort_order')?.valueNumber ?? index,
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

// ─── Applications ───────────────────────────────────────────────────────────

/** One `credit_memo_application`, as the settlement and the un-apply read it. */
export interface CreditMemoApplicationRecord {
  id: string
  creditMemoInstanceId: string | null
  invoiceInstanceId: string | null
  /** Integer minor units. */
  amountMinor: number
  /** ISO instant, or `null`. */
  appliedAt: string | null
}

async function applicationFields(
  organizationId: string
): Promise<FieldMap<CreditMemoApplicationAttribute>> {
  return (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      ...CREDIT_MEMO_APPLICATION_ATTRIBUTES,
    ])) as FieldMap<CreditMemoApplicationAttribute>
}

async function loadApplicationsById(
  db: Database,
  organizationId: string,
  fields: FieldMap<CreditMemoApplicationAttribute>,
  ids: readonly string[]
): Promise<CreditMemoApplicationRecord[]> {
  if (ids.length === 0) return []
  const buckets = await selectValues(db, organizationId, ids, fieldIdsOf(fields))
  return ids.map((id) => {
    const { cell } = cellReader(fields, buckets.get(id))
    return {
      id,
      creditMemoInstanceId: cell('credit_memo_application_credit_memo')?.relatedEntityId ?? null,
      invoiceInstanceId: cell('credit_memo_application_invoice')?.relatedEntityId ?? null,
      amountMinor: cell('credit_memo_application_amount')?.valueNumber ?? 0,
      appliedAt: cell('credit_memo_application_applied_at')?.valueDate ?? null,
    }
  })
}

/**
 * Every application of one memo, oldest first. Read off the owning side
 * (`credit_memo_application_credit_memo`), never off the memo's mirrored
 * has_many, so a stale inverse row can neither hide nor invent an application.
 */
export async function listCreditMemoApplications(
  db: Database,
  organizationId: string,
  creditMemoId: string
): Promise<CreditMemoApplicationRecord[]> {
  const fields = await applicationFields(organizationId)
  const ids = await childIdsPointingAt(
    db,
    organizationId,
    fields.credit_memo_application_credit_memo,
    creditMemoId
  )
  return loadApplicationsById(db, organizationId, fields, ids)
}

/** One application by id, or `null`. */
export async function loadCreditMemoApplication(
  db: Database,
  organizationId: string,
  applicationId: string
): Promise<CreditMemoApplicationRecord | null> {
  const fields = await applicationFields(organizationId)
  const live = await liveInstanceIds(db, organizationId, [applicationId])
  if (live.length === 0) return null
  const [row] = await loadApplicationsById(db, organizationId, fields, live)
  return row ?? null
}

/**
 * Integer minor units: what has been applied TO this invoice across every memo,
 * summed from the rows. `applyCreditMemo` refuses on this rather than on the
 * `invoice_amount_credited` mirror, which `syncInvoicePaymentState` rewrites
 * only when it is next run.
 */
export async function sumInvoiceCreditApplications(
  db: Database,
  organizationId: string,
  invoiceId: string
): Promise<number> {
  const fields = await applicationFields(organizationId)
  const ids = await childIdsPointingAt(
    db,
    organizationId,
    fields.credit_memo_application_invoice,
    invoiceId
  )
  const rows = await loadApplicationsById(db, organizationId, fields, ids)
  return rows.reduce((sum, row) => sum + row.amountMinor, 0)
}

/** Integer minor units: what has been applied off this memo, summed from the rows. */
export async function sumCreditMemoApplications(
  db: Database,
  organizationId: string,
  creditMemoId: string
): Promise<number> {
  const rows = await listCreditMemoApplications(db, organizationId, creditMemoId)
  return rows.reduce((sum, row) => sum + row.amountMinor, 0)
}

// ─── Refunds ────────────────────────────────────────────────────────────────

/**
 * Every refund `PaymentTransaction` carrying this memo, oldest first, whatever
 * its status. The delete guard reads the whole list; the settlement sums only
 * the `succeeded` rows.
 */
export async function listCreditMemoRefunds(
  db: Database,
  organizationId: string,
  creditMemoId: string
): Promise<CreditMemoRefundRow[]> {
  const rows = await db.query.PaymentTransaction.findMany({
    where: and(
      eq(schema.PaymentTransaction.organizationId, organizationId),
      eq(schema.PaymentTransaction.creditMemoInstanceId, creditMemoId),
      eq(schema.PaymentTransaction.kind, 'refund')
    ),
    orderBy: asc(schema.PaymentTransaction.createdAt),
  })
  return rows.map((row) => ({
    transactionId: row.id,
    provider: row.provider,
    status: row.status,
    amountMinor: row.amount,
    method: row.method ?? null,
    reference: row.reference ?? null,
    createdAt: row.createdAt.toISOString(),
  }))
}

/** Integer minor units: the `succeeded` refunds carrying this memo, summed. */
export async function sumSucceededCreditMemoRefunds(
  db: Database,
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

async function invoiceFields(organizationId: string): Promise<FieldMap<InvoiceAttribute>> {
  return (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...INVOICE_ATTRIBUTES])) as FieldMap<InvoiceAttribute>
}

function invoiceFromBucket(
  id: string,
  fields: FieldMap<InvoiceAttribute>,
  bucket: Map<string, ValueRow[]> | undefined
): InvoiceForCredit | null {
  const { cell, cells } = cellReader(fields, bucket)
  const status = cell('invoice_status')?.optionId
  if (!status) return null
  return {
    id,
    number: cell('invoice_number')?.valueText ?? '',
    status,
    contactInstanceId: cell('invoice_contact')?.relatedEntityId ?? null,
    issuedAt: toCalendarDay(cell('invoice_issued_at')?.valueDate),
    dueDate: toCalendarDay(cell('invoice_due_date')?.valueDate),
    taxRate: cell('invoice_tax_rate')?.valueNumber ?? null,
    subtotalMinor: cell('invoice_subtotal')?.valueNumber ?? 0,
    taxTotalMinor: cell('invoice_tax_total')?.valueNumber ?? 0,
    totalMinor: cell('invoice_total')?.valueNumber ?? 0,
    amountPaidMinor: cell('invoice_amount_paid')?.valueNumber ?? 0,
    amountCreditedMinor: cell('invoice_amount_credited')?.valueNumber ?? 0,
    balanceMinor: cell('invoice_balance')?.valueNumber ?? 0,
    lineIds: cells('invoice_line_items')
      .map((row) => row.relatedEntityId)
      .filter((lineId): lineId is string => !!lineId),
  }
}

/** One invoice's header, or `null`. */
export async function loadInvoiceForCredit(
  db: Database,
  organizationId: string,
  invoiceId: string
): Promise<InvoiceForCredit | null> {
  const fields = await invoiceFields(organizationId)
  if (!fields.invoice_status) return null
  const live = await liveInstanceIds(db, organizationId, [invoiceId])
  if (live.length === 0) return null
  const buckets = await selectValues(db, organizationId, [invoiceId], fieldIdsOf(fields))
  return invoiceFromBucket(invoiceId, fields, buckets.get(invoiceId))
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
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...LINE_ITEM_ATTRIBUTES])) as FieldMap<LineItemAttribute>
  const live = await liveInstanceIds(db, organizationId, lineIds)
  const buckets = await selectValues(db, organizationId, live, fieldIdsOf(fields))

  return live
    .flatMap((lineId, index) => {
      const { cell } = cellReader(fields, buckets.get(lineId))
      if (cell('line_item_work_order')?.relatedEntityId) return []
      const taxable = cell('line_item_taxable')?.valueBoolean
      return [
        {
          id: lineId,
          name: cell('line_item_name')?.valueText ?? 'Line item',
          qty: cell('line_item_qty')?.valueNumber ?? 0,
          unitPriceMinor: cell('line_item_unit_price')?.valueNumber ?? null,
          lineTotalMinor: cell('line_item_line_total')?.valueNumber ?? null,
          // An absent row is taxable, the default the totals engine applies.
          taxable: taxable == null ? true : taxable,
          taxTotalMinor: cell('line_item_tax_total')?.valueNumber ?? null,
          sortOrder: cell('line_item_sort_order')?.valueNumber ?? index,
        },
      ]
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

// ─── The order ──────────────────────────────────────────────────────────────

/**
 * Whether the order had a fulfillment shipped on or before `issuedAt`.
 *
 * Read from the order's shipment log (`order_fulfillments`, the same JSON
 * `readOrderForFulfillment` parses), never from `order_fulfillment_status`: the
 * status says `partial` and cannot say WHEN. A channel memo on an order with no
 * shipment before its date reverses revenue that was never posted, so the
 * issue entry omits the revenue leg (section 3.1).
 */
export async function orderHadFulfillmentBefore(
  db: Database,
  organizationId: string,
  orderId: string,
  issuedAt: string
): Promise<boolean> {
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['order_fulfillments'])) as FieldMap<'order_fulfillments'>
  if (!fields.order_fulfillments) return false

  const [row] = await db
    .select({ valueJson: schema.FieldValue.valueJson })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, orderId),
        eq(schema.FieldValue.fieldId, fields.order_fulfillments.id)
      )
    )
    .limit(1)
  if (!row) return false

  const fulfillments = parseFulfillments(row.valueJson)
  return fulfillments.some((fulfillment) => {
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
    const fields = await invoiceFields(organizationId)
    if (fields.invoice_number) {
      const buckets = await selectValues(db, organizationId, invoiceIds, [fields.invoice_number.id])
      for (const invoiceId of invoiceIds) {
        const { cell } = cellReader(fields, buckets.get(invoiceId))
        invoiceNumbers.set(invoiceId, cell('invoice_number')?.valueText ?? '')
      }
    }
  }

  const amountAppliedMinor = applications.reduce((sum, row) => sum + row.amountMinor, 0)
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
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...CREDIT_MEMO_ATTRIBUTES])) as FieldMap<CreditMemoAttribute>

  const memoIds = await childIdsPointingAt(
    db,
    organizationId,
    fields.credit_memo_contact,
    contactInstanceId
  )
  if (memoIds.length === 0) return { contactInstanceId, creditAvailableMinor: 0, memos: [] }

  const buckets = await selectValues(db, organizationId, memoIds, fieldIdsOf(fields))
  const memos: ContactCreditMemo[] = []
  for (const memoId of memoIds) {
    const { cell } = cellReader(fields, buckets.get(memoId))
    if (cell('credit_memo_status')?.optionId !== 'issued') continue
    const balanceMinor = cell('credit_memo_balance')?.valueNumber ?? 0
    if (balanceMinor <= 0) continue
    memos.push({
      creditMemoInstanceId: memoId,
      number: cell('credit_memo_number')?.valueText ?? '',
      issuedAt: toCalendarDay(cell('credit_memo_issued_at')?.valueDate),
      totalMinor: cell('credit_memo_total')?.valueNumber ?? 0,
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
  const fields = await invoiceFields(organizationId)
  if (!fields.invoice_status) return []

  const invoiceIds = await childIdsPointingAt(
    db,
    organizationId,
    fields.invoice_contact,
    contactInstanceId
  )
  if (invoiceIds.length === 0) return []

  const buckets = await selectValues(db, organizationId, invoiceIds, fieldIdsOf(fields))
  const rows: OpenInvoiceRow[] = []
  for (const invoiceId of invoiceIds) {
    const invoice = invoiceFromBucket(invoiceId, fields, buckets.get(invoiceId))
    if (!invoice || !OPEN_INVOICE_STATUSES.has(invoice.status)) continue
    const balanceMinor = resolveInvoiceOutstandingMinor(invoice)
    if (balanceMinor <= 0) continue
    rows.push({
      invoiceInstanceId: invoiceId,
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

  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...CREDIT_MEMO_ATTRIBUTES])) as FieldMap<CreditMemoAttribute>

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
    .innerJoin(
      source,
      and(
        eq(source.entityId, schema.FieldValue.entityId),
        eq(source.organizationId, schema.FieldValue.organizationId),
        eq(source.fieldId, sourceField.id)
      )
    )
    .innerJoin(
      issuedAt,
      and(
        eq(issuedAt.entityId, schema.FieldValue.entityId),
        eq(issuedAt.organizationId, schema.FieldValue.organizationId),
        eq(issuedAt.fieldId, issuedAtField.id)
      )
    )
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
