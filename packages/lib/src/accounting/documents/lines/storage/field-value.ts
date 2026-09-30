// packages/lib/src/accounting/documents/lines/storage/field-value.ts

// The L0 backend: lines as entity instances with FieldValue cells. The only file that knows
// line attrs; L2 replaces it (plans/entity/domain-tables/03-line-tables.md §2).
import type { Database, Transaction } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import type { FileValue } from '../../../../field-values/converters/json'
import type { UnifiedCrudHandler } from '../../../../resources/crud/unified-handler'
import { CREDIT_MEMO_LINE_FIELDS } from '../../../../resources/registry/resources/credit-memo-line-fields'
import { LINE_ITEM_FIELDS } from '../../../../resources/registry/resources/line-item-fields'
import { PURCHASE_ORDER_LINE_FIELDS } from '../../../../resources/registry/resources/purchase-order-line-fields'
import { VENDOR_BILL_LINE_FIELDS } from '../../../../resources/registry/resources/vendor-bill-line-fields'
import { VENDOR_CREDIT_LINE_FIELDS } from '../../../../resources/registry/resources/vendor-credit-line-fields'
import { pickSystemAttributes } from '../../../../resources/registry/system-attributes'
import {
  readSystemRecords,
  type SystemRecord,
  systemFields,
} from '../../../../resources/system-records'
import {
  LINE_KEYS,
  LINE_KINDS,
  type Line,
  type LineDocumentType,
  type LineEntityType,
  type LineKey,
  type LinePatch,
} from '../client'

/** How a cell is read and written. `related` names the target entity type for the write. */
type Cell = 'text' | 'number' | 'boolean' | 'option' | 'date' | 'files' | { related: string }

type Column<A extends string> = { attr: A; cell: Cell }

interface EntityStorage<A extends string> {
  lineEntityType: LineEntityType
  attributes: readonly A[]
  columns: Partial<Record<LineKey, Column<A>>>
  sortAttr: A
}

const LINE_ITEM_ATTRIBUTES = pickSystemAttributes(LINE_ITEM_FIELDS, [
  'line_item_name',
  'line_item_description',
  'line_item_category',
  'line_item_unit',
  'line_item_qty',
  'line_item_unit_price',
  'line_item_discount',
  'line_item_taxable',
  'line_item_line_total',
  'line_item_net_total',
  'line_item_tax_total',
  'line_item_optional',
  'line_item_optional_selected',
  'line_item_part',
  'line_item_visit_id',
  'line_item_source_line',
  'line_item_fulfilled_at',
  'line_item_fulfilled_qty',
  'line_item_shipment_count',
  'line_item_photos',
  'line_item_sort_order',
  'line_item_quote',
  'line_item_invoice',
  'line_item_order',
  'line_item_work_order',
] as const)
type LineItemAttr = (typeof LINE_ITEM_ATTRIBUTES)[number]

const LINE_ITEM: EntityStorage<LineItemAttr> = {
  lineEntityType: 'line_item',
  attributes: LINE_ITEM_ATTRIBUTES,
  sortAttr: 'line_item_sort_order',
  columns: {
    sortOrder: { attr: 'line_item_sort_order', cell: 'number' },
    name: { attr: 'line_item_name', cell: 'text' },
    description: { attr: 'line_item_description', cell: 'text' },
    category: { attr: 'line_item_category', cell: 'option' },
    unit: { attr: 'line_item_unit', cell: 'option' },
    qty: { attr: 'line_item_qty', cell: 'number' },
    unitPrice: { attr: 'line_item_unit_price', cell: 'number' },
    discount: { attr: 'line_item_discount', cell: 'number' },
    taxable: { attr: 'line_item_taxable', cell: 'boolean' },
    lineTotal: { attr: 'line_item_line_total', cell: 'number' },
    netTotal: { attr: 'line_item_net_total', cell: 'number' },
    taxTotal: { attr: 'line_item_tax_total', cell: 'number' },
    optional: { attr: 'line_item_optional', cell: 'boolean' },
    optionalSelected: { attr: 'line_item_optional_selected', cell: 'boolean' },
    partId: { attr: 'line_item_part', cell: { related: 'part' } },
    visitId: { attr: 'line_item_visit_id', cell: 'text' },
    sourceLineId: { attr: 'line_item_source_line', cell: 'text' },
    fulfilledAt: { attr: 'line_item_fulfilled_at', cell: 'date' },
    fulfilledQty: { attr: 'line_item_fulfilled_qty', cell: 'number' },
    shipmentCount: { attr: 'line_item_shipment_count', cell: 'number' },
    photos: { attr: 'line_item_photos', cell: 'files' },
  },
}

const CREDIT_MEMO_LINE_ATTRIBUTES = pickSystemAttributes(CREDIT_MEMO_LINE_FIELDS, [
  'credit_memo_line_description',
  'credit_memo_line_qty',
  'credit_memo_line_unit_price',
  'credit_memo_line_subtotal',
  'credit_memo_line_tax_total',
  'credit_memo_line_disposition',
  'credit_memo_line_line_item',
  'credit_memo_line_sort_order',
  'credit_memo_line_credit_memo',
] as const)
type CreditMemoLineAttr = (typeof CREDIT_MEMO_LINE_ATTRIBUTES)[number]

/** A memo line has no `name`: its one text is the description, and its line total is `subtotal`. */
const CREDIT_MEMO_LINE: EntityStorage<CreditMemoLineAttr> = {
  lineEntityType: 'credit_memo_line',
  attributes: CREDIT_MEMO_LINE_ATTRIBUTES,
  sortAttr: 'credit_memo_line_sort_order',
  columns: {
    sortOrder: { attr: 'credit_memo_line_sort_order', cell: 'number' },
    name: { attr: 'credit_memo_line_description', cell: 'text' },
    qty: { attr: 'credit_memo_line_qty', cell: 'number' },
    unitPrice: { attr: 'credit_memo_line_unit_price', cell: 'number' },
    lineTotal: { attr: 'credit_memo_line_subtotal', cell: 'number' },
    taxTotal: { attr: 'credit_memo_line_tax_total', cell: 'number' },
    disposition: { attr: 'credit_memo_line_disposition', cell: 'option' },
    sourceLineItemId: { attr: 'credit_memo_line_line_item', cell: { related: 'line_item' } },
  },
}

const PURCHASE_ORDER_LINE_ATTRIBUTES = pickSystemAttributes(PURCHASE_ORDER_LINE_FIELDS, [
  'purchase_order_line_description',
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_expected_unit_price',
  'purchase_order_line_line_total',
  'purchase_order_line_part',
  'purchase_order_line_vendor_part',
  'purchase_order_line_weight',
  'purchase_order_line_quantity_received',
  'purchase_order_line_quantity_billed',
  'purchase_order_line_sort_order',
  'purchase_order_line_purchase_order',
] as const)
type PurchaseOrderLineAttr = (typeof PURCHASE_ORDER_LINE_ATTRIBUTES)[number]

/** `unitPrice` is the order's expected cost, the price arm of the three-way match. */
const PURCHASE_ORDER_LINE: EntityStorage<PurchaseOrderLineAttr> = {
  lineEntityType: 'purchase_order_line',
  attributes: PURCHASE_ORDER_LINE_ATTRIBUTES,
  sortAttr: 'purchase_order_line_sort_order',
  columns: {
    sortOrder: { attr: 'purchase_order_line_sort_order', cell: 'number' },
    description: { attr: 'purchase_order_line_description', cell: 'text' },
    qty: { attr: 'purchase_order_line_quantity_ordered', cell: 'number' },
    unitPrice: { attr: 'purchase_order_line_expected_unit_price', cell: 'number' },
    lineTotal: { attr: 'purchase_order_line_line_total', cell: 'number' },
    partId: { attr: 'purchase_order_line_part', cell: { related: 'part' } },
    vendorPartId: { attr: 'purchase_order_line_vendor_part', cell: { related: 'vendor_part' } },
    weight: { attr: 'purchase_order_line_weight', cell: 'number' },
    quantityReceived: { attr: 'purchase_order_line_quantity_received', cell: 'number' },
    quantityBilled: { attr: 'purchase_order_line_quantity_billed', cell: 'number' },
  },
}

const VENDOR_BILL_LINE_ATTRIBUTES = pickSystemAttributes(VENDOR_BILL_LINE_FIELDS, [
  'vendor_bill_line_description',
  'vendor_bill_line_vendor_code',
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_unit_price',
  'vendor_bill_line_line_total',
  'vendor_bill_line_part',
  'vendor_bill_line_purchase_order_line',
  'vendor_bill_line_landed_bill',
  'vendor_bill_line_gl_account',
  'vendor_bill_line_sort_order',
  'vendor_bill_line_vendor_bill',
] as const)
type VendorBillLineAttr = (typeof VENDOR_BILL_LINE_ATTRIBUTES)[number]

const VENDOR_BILL_LINE: EntityStorage<VendorBillLineAttr> = {
  lineEntityType: 'vendor_bill_line',
  attributes: VENDOR_BILL_LINE_ATTRIBUTES,
  sortAttr: 'vendor_bill_line_sort_order',
  columns: {
    sortOrder: { attr: 'vendor_bill_line_sort_order', cell: 'number' },
    description: { attr: 'vendor_bill_line_description', cell: 'text' },
    vendorCode: { attr: 'vendor_bill_line_vendor_code', cell: 'text' },
    qty: { attr: 'vendor_bill_line_quantity_billed', cell: 'number' },
    unitPrice: { attr: 'vendor_bill_line_unit_price', cell: 'number' },
    lineTotal: { attr: 'vendor_bill_line_line_total', cell: 'number' },
    partId: { attr: 'vendor_bill_line_part', cell: { related: 'part' } },
    purchaseOrderLineId: {
      attr: 'vendor_bill_line_purchase_order_line',
      cell: { related: 'purchase_order_line' },
    },
    landedBillId: { attr: 'vendor_bill_line_landed_bill', cell: { related: 'vendor_bill' } },
    glAccountId: { attr: 'vendor_bill_line_gl_account', cell: 'text' },
  },
}

const VENDOR_CREDIT_LINE_ATTRIBUTES = pickSystemAttributes(VENDOR_CREDIT_LINE_FIELDS, [
  'vendor_credit_line_description',
  'vendor_credit_line_quantity',
  'vendor_credit_line_unit_price',
  'vendor_credit_line_line_total',
  'vendor_credit_line_part',
  'vendor_credit_line_purchase_order_line',
  'vendor_credit_line_gl_account',
  'vendor_credit_line_returns_stock',
  'vendor_credit_line_sort_order',
  'vendor_credit_line_vendor_credit',
] as const)
type VendorCreditLineAttr = (typeof VENDOR_CREDIT_LINE_ATTRIBUTES)[number]

const VENDOR_CREDIT_LINE: EntityStorage<VendorCreditLineAttr> = {
  lineEntityType: 'vendor_credit_line',
  attributes: VENDOR_CREDIT_LINE_ATTRIBUTES,
  sortAttr: 'vendor_credit_line_sort_order',
  columns: {
    sortOrder: { attr: 'vendor_credit_line_sort_order', cell: 'number' },
    description: { attr: 'vendor_credit_line_description', cell: 'text' },
    qty: { attr: 'vendor_credit_line_quantity', cell: 'number' },
    unitPrice: { attr: 'vendor_credit_line_unit_price', cell: 'number' },
    lineTotal: { attr: 'vendor_credit_line_line_total', cell: 'number' },
    partId: { attr: 'vendor_credit_line_part', cell: { related: 'part' } },
    purchaseOrderLineId: {
      attr: 'vendor_credit_line_purchase_order_line',
      cell: { related: 'purchase_order_line' },
    },
    glAccountId: { attr: 'vendor_credit_line_gl_account', cell: 'text' },
    returnsStock: { attr: 'vendor_credit_line_returns_stock', cell: 'boolean' },
  },
}

/** One kind's storage: the entity, the parent relation and the membership rule. */
interface KindStorage {
  entity: EntityStorage<string>
  parentAttr: string
  /** invoice: a work-order source line stamped with the invoice belongs to the work order. */
  excludeAttr?: string
}

/** Per kind. Exported for the contract test; nothing else reads it. */
export const KIND_STORAGE: Record<LineDocumentType, KindStorage> = {
  quote: { entity: LINE_ITEM, parentAttr: 'line_item_quote' },
  order: { entity: LINE_ITEM, parentAttr: 'line_item_order' },
  invoice: {
    entity: LINE_ITEM,
    parentAttr: 'line_item_invoice',
    excludeAttr: 'line_item_work_order',
  },
  work_order: { entity: LINE_ITEM, parentAttr: 'line_item_work_order' },
  credit_memo: { entity: CREDIT_MEMO_LINE, parentAttr: 'credit_memo_line_credit_memo' },
  purchase_order: {
    entity: PURCHASE_ORDER_LINE,
    parentAttr: 'purchase_order_line_purchase_order',
  },
  vendor_bill: { entity: VENDOR_BILL_LINE, parentAttr: 'vendor_bill_line_vendor_bill' },
  vendor_credit: { entity: VENDOR_CREDIT_LINE, parentAttr: 'vendor_credit_line_vendor_credit' },
}

/**
 * The owning parent of a `line_item`, in the precedence `resolveLineParentDocument` uses:
 * quote, invoice without a work order, order, work order.
 */
const LINE_ITEM_PARENT_LADDER: LineDocumentType[] = ['quote', 'invoice', 'order', 'work_order']

/** A stored line plus what the membership and totals reads need beyond {@link Line}. */
export interface StoredLine {
  line: Line
  createdAt: Date
  /** Whether the line is its parent's own under the kind's membership rule (the invoice exclusion). */
  owned: boolean
}

/** Which lines to read: a document's (by the parent relation) or specific ids. */
export type LineSelector =
  | { documentId: string; includeArchived?: boolean }
  | { ids: readonly string[]; includeArchived?: boolean }

/** Read one kind's lines. Missing def or fields read as no lines. */
export async function readStoredLines(
  db: Database | Transaction,
  organizationId: string,
  documentType: LineDocumentType,
  selector: LineSelector
): Promise<StoredLine[]> {
  const storage = KIND_STORAGE[documentType]
  const { entity } = storage
  const ctx = await systemFields(db, organizationId, entity.lineEntityType, entity.attributes)
  if (!ctx) return []
  const records = await readSystemRecords(db, organizationId, ctx, {
    includeArchived: selector.includeArchived ?? false,
    ...('ids' in selector
      ? { ids: selector.ids }
      : { by: { attribute: storage.parentAttr, in: [selector.documentId] } }),
  })
  return records.map((record) => {
    const line = toLine(documentType, record)
    const excluded = storage.excludeAttr ? record.related(storage.excludeAttr) !== null : false
    const onParent = 'ids' in selector ? true : line.documentId === selector.documentId
    return { line, createdAt: record.createdAt, owned: onParent && !excluded }
  })
}

/** The owning document of a line, or `null` when it hangs off none. */
export async function readStoredLineParent(
  db: Database | Transaction,
  organizationId: string,
  lineId: string
): Promise<{ documentType: LineDocumentType; documentId: string } | null> {
  const parents = await readLineItemParents(db, organizationId, lineId)
  if (parents) {
    for (const documentType of LINE_ITEM_PARENT_LADDER) {
      const documentId = parents[documentType]
      if (!documentId) continue
      if (documentType === 'invoice' && parents.work_order) continue
      return { documentType, documentId }
    }
    return null
  }
  const others = ['credit_memo', 'purchase_order', 'vendor_bill', 'vendor_credit'] as const
  for (const documentType of others) {
    const [stored] = await readStoredLines(db, organizationId, documentType, { ids: [lineId] })
    if (!stored) continue
    return stored.line.documentId ? { documentType, documentId: stored.line.documentId } : null
  }
  return null
}

/** A `line_item`'s four parent slots, or `null` when the id is not a live `line_item`. */
async function readLineItemParents(
  db: Database | Transaction,
  organizationId: string,
  lineId: string
): Promise<Partial<Record<LineDocumentType, string>> | null> {
  const ctx = await systemFields(db, organizationId, 'line_item', LINE_ITEM_ATTRIBUTES)
  if (!ctx) return null
  const [record] = await readSystemRecords(db, organizationId, ctx, { ids: [lineId] })
  if (!record) return null
  const out: Partial<Record<LineDocumentType, string>> = {}
  for (const documentType of LINE_ITEM_PARENT_LADDER) {
    const documentId = record.related(KIND_STORAGE[documentType].parentAttr as LineItemAttr)
    if (documentId) out[documentType] = documentId
  }
  return out
}

function toLine(documentType: LineDocumentType, record: SystemRecord<string>): Line {
  const { entity, parentAttr } = KIND_STORAGE[documentType]
  const values: Record<string, unknown> = {}
  for (const key of LINE_KEYS) {
    const column = entity.columns[key]
    if (!column) {
      if (key !== 'photos') values[key] = null
      continue
    }
    values[key] = readCell(record, column)
  }
  return {
    ...(values as Omit<Line, 'id' | 'documentType' | 'documentId'>),
    id: record.id,
    documentType,
    documentId: record.related(parentAttr) ?? '',
  }
}

function readCell(record: SystemRecord<string>, column: Column<string>): unknown {
  const { attr, cell } = column
  if (typeof cell === 'object') return record.related(attr)
  switch (cell) {
    case 'text':
      return record.text(attr)
    case 'number':
      return record.number(attr)
    case 'boolean':
      return record.boolean(attr)
    case 'option':
      return record.option(attr)
    case 'date':
      return record.date(attr)
    case 'files':
      return record
        .cells(attr)
        .flatMap((value) => (value.type === 'json' ? [value.value as unknown as FileValue] : []))
  }
}

/** The line's `RecordId`, as the crud layer and the field-value service take it. */
export function lineRecordId(documentType: LineDocumentType, lineId: string): RecordId {
  return toRecordId(KIND_STORAGE[documentType].entity.lineEntityType, lineId)
}

/** A patch as `{ attr: value }`, relationships as `RecordId`s. Keys the kind lacks are refused upstream. */
export function patchToValues(
  documentType: LineDocumentType,
  patch: LinePatch
): Record<string, unknown> {
  const { entity } = KIND_STORAGE[documentType]
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const column = entity.columns[key as LineKey]
    if (!column) continue
    values[column.attr] =
      typeof column.cell === 'object' && typeof value === 'string'
        ? toRecordId(column.cell.related, value)
        : value
  }
  return values
}

/** Create one line through the crud handler, so pre-create guards and derive hooks fire. */
export async function createStoredLine(
  handler: UnifiedCrudHandler,
  documentType: LineDocumentType,
  documentId: string,
  patch: LinePatch,
  sortOrder: number
): Promise<string> {
  const { entity, parentAttr } = KIND_STORAGE[documentType]
  const values = {
    ...patchToValues(documentType, patch),
    [parentAttr]: toRecordId(LINE_KINDS[documentType].parentEntityType, documentId),
    [entity.sortAttr]: sortOrder,
  }
  const created = await handler.create(entity.lineEntityType, values)
  return created.instance.id
}

/**
 * Write a patch one field at a time. `setValuesForEntity` swallows a field pre-hook's refusal
 * into a `failed` result; this path throws it, as `fieldValue.set` always has.
 */
export async function writeStoredLine(
  handler: UnifiedCrudHandler,
  documentType: LineDocumentType,
  lineId: string,
  patch: LinePatch
): Promise<void> {
  const recordId = lineRecordId(documentType, lineId)
  for (const [fieldId, value] of Object.entries(patchToValues(documentType, patch))) {
    await handler.fieldValueService.setValueWithBuiltIn({ recordId, fieldId, value })
  }
}

/** Write one line's sort order. */
export async function writeStoredSortOrder(
  handler: UnifiedCrudHandler,
  documentType: LineDocumentType,
  lineId: string,
  sortOrder: number
): Promise<void> {
  await handler.fieldValueService.setValueWithBuiltIn({
    recordId: lineRecordId(documentType, lineId),
    fieldId: KIND_STORAGE[documentType].entity.sortAttr,
    value: sortOrder,
  })
}

/** Delete one line through the crud handler, so pre-delete guards and post-delete marks fire. */
export async function deleteStoredLine(
  handler: UnifiedCrudHandler,
  documentType: LineDocumentType,
  lineId: string,
  options: { suppressPostDeleteHooks?: boolean } = {}
): Promise<void> {
  await handler.delete(lineRecordId(documentType, lineId), options)
}

/** The invoice's lifecycle status, for the delete arm's draft check. */
export async function readInvoiceStatus(
  db: Database | Transaction,
  organizationId: string,
  invoiceId: string
): Promise<string | null> {
  const ctx = await systemFields(db, organizationId, 'invoice', ['invoice_status'] as const)
  if (!ctx) return null
  const [record] = await readSystemRecords(db, organizationId, ctx, { ids: [invoiceId] })
  return record?.option('invoice_status') ?? null
}
