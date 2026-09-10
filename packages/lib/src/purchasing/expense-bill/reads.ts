// packages/lib/src/purchasing/expense-bill/reads.ts
//
// Reading one vendor bill and its coded lines, as the expense-bill posting path
// needs them. Reads only: the writer is `writes.ts`
// (`docs/lib-module-guide.md` §5).
//
// Values come off `FieldValue`'s own columns rather than through
// `UnifiedCrudHandler.getFieldValues` - the trade `money/credit-memos/reads.ts`
// and `money/invoices/post-invoice.ts` both make. No actor is needed, so the
// preview and the writer share one loader, and a relationship's
// `relatedEntityId` is read as the id it is rather than unwrapped from a typed
// envelope.
//
// No permission checks anywhere in this file. The router asserts (§6).

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { NotFoundError } from '../../errors'

/** Every `vendor_bill` attribute the posting path reads. */
const VENDOR_BILL_ATTRIBUTES = [
  'vendor_bill_number',
  'vendor_bill_internal_number',
  'vendor_bill_status',
  'vendor_bill_billed_at',
  'vendor_bill_currency',
  'vendor_bill_total',
  'vendor_bill_vendor',
  'vendor_bill_lines',
] as const

/** Every `vendor_bill_line` attribute the posting path reads. */
const VENDOR_BILL_LINE_ATTRIBUTES = [
  'vendor_bill_line_description',
  'vendor_bill_line_line_total',
  'vendor_bill_line_gl_account',
  'vendor_bill_line_sort_order',
] as const

type VendorBillAttribute = (typeof VENDOR_BILL_ATTRIBUTES)[number]
type VendorBillLineAttribute = (typeof VENDOR_BILL_LINE_ATTRIBUTES)[number]

type FieldMap<A extends string> = Record<A, { id: string } | null>

/** One `FieldValue` row, in the columns this module reads. */
interface ValueRow {
  entityId: string
  fieldId: string
  valueText: string | null
  valueNumber: number | null
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
): { cell: (attribute: A) => ValueRow | undefined; cells: (attribute: A) => ValueRow[] } {
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
 * calendar day the bookkeeper wrote, so it is sliced, never re-zoned - the rule
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

/** One coded line of a bill, as the builder reads it. */
export interface VendorBillLineRecord {
  id: string
  description: string | null
  /** Integer minor units. `0` when the line carries no total at all. */
  lineTotalMinor: number
  /** The `gl_account` instance id, or `null` when the line is uncoded. */
  glAccountId: string | null
  sortOrder: number
}

/** One vendor bill's header, as the expense-bill posting path reads it. */
export interface VendorBillRecord {
  id: string
  /** The VENDOR's own invoice number. For messages, never for the claim key. */
  number: string
  /** OURS - `BILL-0007`. What the entry's period key and document number key on. */
  internalNumber: string
  status: string
  /** `YYYY-MM-DD`, or `null` when the bill has not been dated yet. */
  billedAt: string | null
  currency: string | null
  /** Integer minor units. Transcribed from the vendor's document, never derived. */
  totalMinor: number
  /** The `company` instance id this bill is owed to. The A/P counterparty. */
  vendorCompanyInstanceId: string | null
  lineIds: string[]
}

/**
 * Read one bill's header, or `null` when it does not exist, is archived, or the
 * org has not seeded the `vendor_bill` def.
 */
export async function loadVendorBill(
  db: Database,
  organizationId: string,
  vendorBillId: string
): Promise<VendorBillRecord | null> {
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...VENDOR_BILL_ATTRIBUTES])) as FieldMap<VendorBillAttribute>
  if (!fields.vendor_bill_status || !fields.vendor_bill_total) return null

  const [instance] = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, vendorBillId),
        eq(schema.EntityInstance.organizationId, organizationId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  if (!instance) return null

  const buckets = await selectValues(db, organizationId, [vendorBillId], fieldIdsOf(fields))
  const { cell, cells } = cellReader(fields, buckets.get(vendorBillId))

  return {
    id: vendorBillId,
    number: cell('vendor_bill_number')?.valueText ?? '',
    internalNumber: cell('vendor_bill_internal_number')?.valueText ?? '',
    // A bill created before the status field carried a default reads as its own
    // default rather than as a blank the postable-status wall would let through.
    status: cell('vendor_bill_status')?.optionId ?? 'draft',
    billedAt: toCalendarDay(cell('vendor_bill_billed_at')?.valueDate),
    currency: cell('vendor_bill_currency')?.valueText ?? null,
    totalMinor: cell('vendor_bill_total')?.valueNumber ?? 0,
    vendorCompanyInstanceId: cell('vendor_bill_vendor')?.relatedEntityId ?? null,
    lineIds: cells('vendor_bill_lines')
      .map((row) => row.relatedEntityId)
      .filter((id): id is string => !!id),
  }
}

/** {@link loadVendorBill}, as the refusal a writer needs. */
export async function requireVendorBill(
  db: Database,
  organizationId: string,
  vendorBillId: string
): Promise<VendorBillRecord> {
  const bill = await loadVendorBill(db, organizationId, vendorBillId)
  if (!bill) throw new NotFoundError('Vendor bill not found', { vendorBillId })
  return bill
}

/** The bill's lines, in display order. Archived lines are dropped. */
export async function loadVendorBillLines(
  db: Database,
  organizationId: string,
  lineIds: readonly string[]
): Promise<VendorBillLineRecord[]> {
  if (lineIds.length === 0) return []
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...VENDOR_BILL_LINE_ATTRIBUTES])) as FieldMap<VendorBillLineAttribute>

  const live = await liveInstanceIds(db, organizationId, lineIds)
  const buckets = await selectValues(db, organizationId, live, fieldIdsOf(fields))

  return live
    .map((lineId, index) => {
      const { cell } = cellReader(fields, buckets.get(lineId))
      return {
        id: lineId,
        description: cell('vendor_bill_line_description')?.valueText ?? null,
        lineTotalMinor: cell('vendor_bill_line_line_total')?.valueNumber ?? 0,
        glAccountId: cell('vendor_bill_line_gl_account')?.valueText ?? null,
        sortOrder: cell('vendor_bill_line_sort_order')?.valueNumber ?? index,
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
}
