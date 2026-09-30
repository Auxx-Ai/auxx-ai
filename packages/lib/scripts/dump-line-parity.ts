// packages/lib/scripts/dump-line-parity.ts
//
// The line parity dump (plans/entity/domain-tables/01-lines-module.md §7): for up
// to 50 documents per line kind on one org, the normalized lines, the header
// mirrors, the PDF line payload and the edit-snapshot capture, as sorted JSON.
//
//   npx dotenv -- npx tsx --conditions=source packages/lib/scripts/dump-line-parity.ts \
//     --out <file> [--org DemoOrg1]
// (`--conditions=source` resolves `@auxx/*` to src in a checkout with no built dist.)

import { writeFileSync } from 'node:fs'
import { closePools, type Database, database, schema } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { and, asc, eq } from 'drizzle-orm'
import { documentEditRow } from '../src/accounting/documents/edit-in-place/spec'
import { readDocumentLines } from '../src/accounting/documents/lines'
import { getPaymentAccount } from '../src/accounting/money/stripe-connect/account'
import { isPaymentsConnected } from '../src/accounting/sales/public-token'
import { getOrgCache } from '../src/cache'
import {
  buildCreditMemoPdfPayload,
  buildInvoicePdfPayload,
  buildPurchaseOrderPdfPayload,
  buildQuotePdfPayload,
} from '../src/documents/payload'
import { captureRecordSnapshot, readEditStamp } from '../src/entity-instances/edit-snapshot'
import { CREDIT_MEMO_LINE_FIELDS } from '../src/resources/registry/resources/credit-memo-line-fields'
import { LINE_ITEM_FIELDS } from '../src/resources/registry/resources/line-item-fields'
import { PURCHASE_ORDER_LINE_FIELDS } from '../src/resources/registry/resources/purchase-order-line-fields'
import { VENDOR_BILL_LINE_FIELDS } from '../src/resources/registry/resources/vendor-bill-line-fields'
import { VENDOR_CREDIT_LINE_FIELDS } from '../src/resources/registry/resources/vendor-credit-line-fields'
import { pickSystemAttributes } from '../src/resources/registry/system-attributes'
import { toRecordId } from '../src/resources/resource-id'
import {
  readSystemRecords,
  type SystemRecord,
  systemDefId,
  systemFields,
  systemRecordScope,
} from '../src/resources/system-records'

const DOCS_PER_KIND = 50

const LINE_DOCUMENT_TYPES = [
  'quote',
  'order',
  'invoice',
  'work_order',
  'credit_memo',
  'purchase_order',
  'vendor_bill',
  'vendor_credit',
] as const
type LineDocumentType = (typeof LINE_DOCUMENT_TYPES)[number]

/** The `Line` of 01 §1.1, defined locally until the L0 module ships its own. */
interface ParityLine {
  id: string
  documentType: LineDocumentType
  documentId: string
  sortOrder: number | null
  name: string | null
  description: string | null
  category: string | null
  unit: string | null
  qty: number | null
  unitPrice: number | null
  discount: number | null
  taxable: boolean | null
  lineTotal: number | null
  netTotal: number | null
  taxTotal: number | null
  optional: boolean | null
  optionalSelected: boolean | null
  partId: string | null
  visitId: string | null
  sourceLineId: string | null
  fulfilledAt: string | null
  fulfilledQty: number | null
  shipmentCount: number | null
  photos: unknown[] | null
  sourceLineItemId: string | null
  disposition: string | null
  vendorPartId: string | null
  quantityReceived: number | null
  quantityBilled: number | null
  expectedUnitPrice: number | null
  weight: number | null
  glAccountId: string | null
  landedBillId: string | null
  purchaseOrderLineId: string | null
  vendorCode: string | null
  returnsStock: boolean | null
}

const LINE_ITEM_ATTRS = pickSystemAttributes(LINE_ITEM_FIELDS, [
  'line_item_sort_order',
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
  'line_item_quote',
  'line_item_order',
  'line_item_invoice',
  'line_item_work_order',
])

const CREDIT_MEMO_LINE_ATTRS = pickSystemAttributes(CREDIT_MEMO_LINE_FIELDS, [
  'credit_memo_line_sort_order',
  'credit_memo_line_description',
  'credit_memo_line_qty',
  'credit_memo_line_unit_price',
  'credit_memo_line_subtotal',
  'credit_memo_line_tax_total',
  'credit_memo_line_disposition',
  'credit_memo_line_line_item',
  'credit_memo_line_credit_memo',
])

const PURCHASE_ORDER_LINE_ATTRS = pickSystemAttributes(PURCHASE_ORDER_LINE_FIELDS, [
  'purchase_order_line_sort_order',
  'purchase_order_line_description',
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_expected_unit_price',
  'purchase_order_line_line_total',
  'purchase_order_line_part',
  'purchase_order_line_vendor_part',
  'purchase_order_line_quantity_received',
  'purchase_order_line_quantity_billed',
  'purchase_order_line_weight',
  'purchase_order_line_purchase_order',
])

const VENDOR_BILL_LINE_ATTRS = pickSystemAttributes(VENDOR_BILL_LINE_FIELDS, [
  'vendor_bill_line_sort_order',
  'vendor_bill_line_description',
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_unit_price',
  'vendor_bill_line_line_total',
  'vendor_bill_line_part',
  'vendor_bill_line_purchase_order_line',
  'vendor_bill_line_landed_bill',
  'vendor_bill_line_gl_account',
  'vendor_bill_line_vendor_code',
  'vendor_bill_line_vendor_bill',
])

const VENDOR_CREDIT_LINE_ATTRS = pickSystemAttributes(VENDOR_CREDIT_LINE_FIELDS, [
  'vendor_credit_line_sort_order',
  'vendor_credit_line_description',
  'vendor_credit_line_quantity',
  'vendor_credit_line_unit_price',
  'vendor_credit_line_line_total',
  'vendor_credit_line_part',
  'vendor_credit_line_purchase_order_line',
  'vendor_credit_line_gl_account',
  'vendor_credit_line_returns_stock',
  'vendor_credit_line_vendor_credit',
])

type LineItemAttr = (typeof LINE_ITEM_ATTRS)[number]

/** The line entity and parent attribute behind each kind. */
const LINE_ENTITY: Record<LineDocumentType, { entityType: string; parentAttr: string }> = {
  quote: { entityType: 'line_item', parentAttr: 'line_item_quote' },
  order: { entityType: 'line_item', parentAttr: 'line_item_order' },
  invoice: { entityType: 'line_item', parentAttr: 'line_item_invoice' },
  work_order: { entityType: 'line_item', parentAttr: 'line_item_work_order' },
  credit_memo: { entityType: 'credit_memo_line', parentAttr: 'credit_memo_line_credit_memo' },
  purchase_order: {
    entityType: 'purchase_order_line',
    parentAttr: 'purchase_order_line_purchase_order',
  },
  vendor_bill: { entityType: 'vendor_bill_line', parentAttr: 'vendor_bill_line_vendor_bill' },
  vendor_credit: {
    entityType: 'vendor_credit_line',
    parentAttr: 'vendor_credit_line_vendor_credit',
  },
}

const LINE_ATTRS: Record<string, readonly string[]> = {
  line_item: LINE_ITEM_ATTRS,
  credit_memo_line: CREDIT_MEMO_LINE_ATTRS,
  purchase_order_line: PURCHASE_ORDER_LINE_ATTRS,
  vendor_bill_line: VENDOR_BILL_LINE_ATTRS,
  vendor_credit_line: VENDOR_CREDIT_LINE_ATTRS,
}

/** The edit lane's content key for the lines, where the family has an edit lane. */
const SNAPSHOT_LINE_KEY: Partial<
  Record<LineDocumentType, { family: Parameters<typeof documentEditRow>[0]; key: string }>
> = {
  quote: { family: 'quote', key: 'lineItems' },
  order: { family: 'order', key: 'lineItems' },
  invoice: { family: 'invoice', key: 'lineItems' },
  credit_memo: { family: 'credit_memo', key: 'lines' },
  purchase_order: { family: 'purchase_order', key: 'lines' },
  vendor_bill: { family: 'vendor_bill', key: 'lines' },
}

function emptyLine(id: string, documentType: LineDocumentType, documentId: string): ParityLine {
  return {
    id,
    documentType,
    documentId,
    sortOrder: null,
    name: null,
    description: null,
    category: null,
    unit: null,
    qty: null,
    unitPrice: null,
    discount: null,
    taxable: null,
    lineTotal: null,
    netTotal: null,
    taxTotal: null,
    optional: null,
    optionalSelected: null,
    partId: null,
    visitId: null,
    sourceLineId: null,
    fulfilledAt: null,
    fulfilledQty: null,
    shipmentCount: null,
    photos: null,
    sourceLineItemId: null,
    disposition: null,
    vendorPartId: null,
    quantityReceived: null,
    quantityBilled: null,
    expectedUnitPrice: null,
    weight: null,
    glAccountId: null,
    landedBillId: null,
    purchaseOrderLineId: null,
    vendorCode: null,
    returnsStock: null,
  }
}

/** One stored line record to the semantic shape; the per-kind attr map lives here only. */
function toParityLine(
  kind: LineDocumentType,
  documentId: string,
  r: SystemRecord<string>
): ParityLine {
  const line = emptyLine(r.id, kind, documentId)
  switch (LINE_ENTITY[kind].entityType) {
    case 'line_item': {
      const li = r as SystemRecord<LineItemAttr>
      return {
        ...line,
        sortOrder: li.number('line_item_sort_order'),
        name: li.text('line_item_name'),
        description: li.text('line_item_description'),
        category: li.option('line_item_category'),
        unit: li.option('line_item_unit'),
        qty: li.number('line_item_qty'),
        unitPrice: li.number('line_item_unit_price'),
        discount: li.number('line_item_discount'),
        taxable: li.boolean('line_item_taxable'),
        lineTotal: li.number('line_item_line_total'),
        netTotal: li.number('line_item_net_total'),
        taxTotal: li.number('line_item_tax_total'),
        optional: li.boolean('line_item_optional'),
        optionalSelected: li.boolean('line_item_optional_selected'),
        partId: li.related('line_item_part'),
        visitId: li.text('line_item_visit_id'),
        sourceLineId: li.text('line_item_source_line'),
        fulfilledAt: li.date('line_item_fulfilled_at'),
        fulfilledQty: li.number('line_item_fulfilled_qty'),
        shipmentCount: li.number('line_item_shipment_count'),
        photos: li.cells('line_item_photos'),
      }
    }
    case 'credit_memo_line':
      return {
        ...line,
        sortOrder: r.number('credit_memo_line_sort_order'),
        name: r.text('credit_memo_line_description'),
        qty: r.number('credit_memo_line_qty'),
        unitPrice: r.number('credit_memo_line_unit_price'),
        lineTotal: r.number('credit_memo_line_subtotal'),
        taxTotal: r.number('credit_memo_line_tax_total'),
        disposition: r.option('credit_memo_line_disposition'),
        sourceLineItemId: r.related('credit_memo_line_line_item'),
      }
    case 'purchase_order_line':
      return {
        ...line,
        sortOrder: r.number('purchase_order_line_sort_order'),
        description: r.text('purchase_order_line_description'),
        qty: r.number('purchase_order_line_quantity_ordered'),
        unitPrice: r.number('purchase_order_line_expected_unit_price'),
        lineTotal: r.number('purchase_order_line_line_total'),
        partId: r.related('purchase_order_line_part'),
        vendorPartId: r.related('purchase_order_line_vendor_part'),
        quantityReceived: r.number('purchase_order_line_quantity_received'),
        quantityBilled: r.number('purchase_order_line_quantity_billed'),
        weight: r.number('purchase_order_line_weight'),
      }
    case 'vendor_bill_line':
      return {
        ...line,
        sortOrder: r.number('vendor_bill_line_sort_order'),
        description: r.text('vendor_bill_line_description'),
        qty: r.number('vendor_bill_line_quantity_billed'),
        unitPrice: r.number('vendor_bill_line_unit_price'),
        lineTotal: r.number('vendor_bill_line_line_total'),
        partId: r.related('vendor_bill_line_part'),
        purchaseOrderLineId: r.related('vendor_bill_line_purchase_order_line'),
        landedBillId: r.related('vendor_bill_line_landed_bill'),
        glAccountId: r.text('vendor_bill_line_gl_account'),
        vendorCode: r.text('vendor_bill_line_vendor_code'),
      }
    case 'vendor_credit_line':
      return {
        ...line,
        sortOrder: r.number('vendor_credit_line_sort_order'),
        description: r.text('vendor_credit_line_description'),
        qty: r.number('vendor_credit_line_quantity'),
        unitPrice: r.number('vendor_credit_line_unit_price'),
        lineTotal: r.number('vendor_credit_line_line_total'),
        partId: r.related('vendor_credit_line_part'),
        purchaseOrderLineId: r.related('vendor_credit_line_purchase_order_line'),
        glAccountId: r.text('vendor_credit_line_gl_account'),
        returnsStock: r.boolean('vendor_credit_line_returns_stock'),
      }
    default:
      throw new Error(`No line mapping for ${kind}`)
  }
}

function bySortOrderThenId(a: ParityLine, b: ParityLine): number {
  // Unsorted lines go last, as `sortOrder` asc NULLS LAST would put them.
  if (a.sortOrder !== b.sortOrder) {
    if (a.sortOrder === null) return 1
    if (b.sortOrder === null) return -1
    return a.sortOrder - b.sortOrder
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** All live lines pointing at the document through the kind's parent attr, before any kind filter. */
async function readParentedLines(
  db: Database,
  organizationId: string,
  documentType: LineDocumentType,
  documentId: string
): Promise<ParityLine[]> {
  const { entityType, parentAttr } = LINE_ENTITY[documentType]
  const ctx = await systemFields(db, organizationId, entityType, LINE_ATTRS[entityType]!)
  if (!ctx) return []
  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: parentAttr, in: [documentId] },
  })
  return records
    .filter((r) => (documentType === 'invoice' ? r.related('line_item_work_order') === null : true))
    .map((r) => toParityLine(documentType, documentId, r))
    .sort(bySortOrderThenId)
}

/** The swap point: `--source module` reads through the L0 lines module instead of FieldValue. */
async function readLinesForDocument(
  db: Database,
  organizationId: string,
  documentType: LineDocumentType,
  documentId: string
): Promise<ParityLine[]> {
  if (arg('--source') === 'module') {
    const lines = await readDocumentLines(db, organizationId, { documentType, documentId })
    return lines.map((line) => {
      const out = emptyLine(line.id, documentType, documentId) as unknown as Record<string, unknown>
      for (const key of Object.keys(out)) {
        if (key in line) out[key] = (line as unknown as Record<string, unknown>)[key] ?? null
      }
      return out as unknown as ParityLine
    })
  }
  const lines = await readParentedLines(db, organizationId, documentType, documentId)
  // The work order's job set: visit extras (visitId set) belong to one visit, not the job.
  return documentType === 'work_order' ? lines.filter((l) => l.visitId === null) : lines
}

async function listDocumentIds(
  db: Database,
  organizationId: string,
  documentType: LineDocumentType
): Promise<string[]> {
  const defId = await systemDefId(db, organizationId, documentType)
  if (!defId) return []
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(systemRecordScope(organizationId, defId))
    .orderBy(asc(schema.EntityInstance.id))
    .limit(DOCS_PER_KIND)
  return rows.map((r) => r.id)
}

async function readHeaderTotals(
  db: Database,
  organizationId: string,
  documentType: LineDocumentType,
  documentIds: string[]
): Promise<
  Map<string, { subtotal: number | null; taxTotal: number | null; total: number | null }>
> {
  const attrs = [
    `${documentType}_subtotal`,
    `${documentType}_tax_total`,
    `${documentType}_total`,
  ] as const
  const out = new Map<
    string,
    { subtotal: number | null; taxTotal: number | null; total: number | null }
  >()
  const ctx = await systemFields(db, organizationId, documentType, attrs)
  if (!ctx || documentIds.length === 0) return out
  const records = await readSystemRecords(db, organizationId, ctx, { ids: documentIds })
  for (const r of records) {
    out.set(r.id, {
      subtotal: r.number(attrs[0]),
      taxTotal: r.number(attrs[1]),
      total: r.number(attrs[2]),
    })
  }
  return out
}

type PdfLines = { lines: unknown[]; subtotal: number; taxTotal: number; total: number }

/** The PDF payload's lines and totals; `null` where the kind has no PDF. */
async function readPdfLines(
  organizationId: string,
  userId: string,
  documentType: LineDocumentType,
  documentId: string,
  invoiceTokenSafe: (invoiceId: string) => boolean
): Promise<PdfLines | { skipped: string } | null> {
  const pick = (p: PdfLines): PdfLines => ({
    lines: p.lines,
    subtotal: p.subtotal,
    taxTotal: p.taxTotal,
    total: p.total,
  })
  const recordId = toRecordId(documentType, documentId) as RecordId
  switch (documentType) {
    case 'quote':
      return pick(
        (await buildQuotePdfPayload({ organizationId, userId, quoteRecordId: recordId })).payload
      )
    case 'invoice':
      // The invoice builder mints a public pay token on first render when payments are live.
      if (!invoiceTokenSafe(documentId)) return { skipped: 'would mint invoice_public_token' }
      return pick(
        (await buildInvoicePdfPayload({ organizationId, userId, invoiceRecordId: recordId }))
          .payload
      )
    case 'purchase_order':
      return pick(
        (
          await buildPurchaseOrderPdfPayload({
            organizationId,
            userId,
            purchaseOrderRecordId: recordId,
          })
        ).payload
      )
    case 'credit_memo':
      return pick(
        (await buildCreditMemoPdfPayload({ organizationId, userId, creditMemoRecordId: recordId }))
          .payload
      )
    default:
      return null
  }
}

class Rollback extends Error {
  constructor(readonly snapshot: unknown) {
    super('rollback')
  }
}

/**
 * The edit lane's capture of the document's lines. `captureRecordSnapshot` inserts the
 * snapshot row, so it runs in a transaction that is always rolled back.
 */
async function readSnapshotLines(
  db: Database,
  organizationId: string,
  userId: string,
  documentType: LineDocumentType,
  documentId: string
): Promise<unknown[] | { skipped: string } | null> {
  const entry = SNAPSHOT_LINE_KEY[documentType]
  if (!entry) return null
  if (await readEditStamp(db, organizationId, documentId)) return { skipped: 'edit open' }
  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as Database
      await captureRecordSnapshot(txDb, {
        organizationId,
        entityInstanceId: documentId,
        children: documentEditRow(entry.family).children,
        byUserId: userId,
      })
      const [row] = await tx
        .select({ snapshot: schema.EntityInstanceEditSnapshot.snapshot })
        .from(schema.EntityInstanceEditSnapshot)
        .where(
          and(
            eq(schema.EntityInstanceEditSnapshot.organizationId, organizationId),
            eq(schema.EntityInstanceEditSnapshot.entityInstanceId, documentId)
          )
        )
      throw new Rollback(row?.snapshot)
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
    const payload = error.snapshot as { children?: Record<string, Array<{ id?: string }>> }
    // `readChildIds` has no ORDER BY, so the capture's own order is not stable.
    return [...(payload?.children?.[entry.key] ?? [])].sort((a, b) =>
      String(a.id).localeCompare(String(b.id))
    )
  }
  return null
}

/** Whole-org checks on the line_item parent slots. */
async function readDiagnostics(db: Database, organizationId: string) {
  const out: Record<string, unknown> = {}
  const liCtx = await systemFields(db, organizationId, 'line_item', LINE_ITEM_ATTRS)
  if (liCtx) {
    const all = await readSystemRecords(db, organizationId, liCtx)
    const parents = [
      'line_item_quote',
      'line_item_order',
      'line_item_invoice',
      'line_item_work_order',
    ] as const
    const combos: Record<string, number> = {}
    const multiValued: string[] = []
    for (const r of all) {
      const set = parents.filter((p) => r.related(p) !== null)
      const key = set.length === 0 ? '(none)' : set.join('+')
      combos[key] = (combos[key] ?? 0) + 1
      if (parents.some((p) => r.cells(p).length > 1)) multiValued.push(r.id)
    }
    out.line_item = {
      total: all.length,
      parentCombinations: combos,
      multiValuedParentIds: multiValued.sort(),
      visitScopedOnWorkOrder: all.filter(
        (r) => r.related('line_item_work_order') !== null && r.text('line_item_visit_id') !== null
      ).length,
    }
  }
  for (const [entityType, parentAttr] of [
    ['credit_memo_line', 'credit_memo_line_credit_memo'],
    ['purchase_order_line', 'purchase_order_line_purchase_order'],
    ['vendor_bill_line', 'vendor_bill_line_vendor_bill'],
    ['vendor_credit_line', 'vendor_credit_line_vendor_credit'],
  ] as const) {
    const ctx = await systemFields(db, organizationId, entityType, LINE_ATTRS[entityType]!)
    if (!ctx) {
      out[entityType] = { provisioned: false }
      continue
    }
    const all = await readSystemRecords(db, organizationId, ctx)
    out[entityType] = {
      total: all.length,
      orphanIds: all
        .filter((r) => r.related(parentAttr) === null)
        .map((r) => r.id)
        .sort(),
    }
  }
  return out
}

/** Keys sorted at every depth, Dates as ISO, `undefined` dropped. */
function stable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = stable(v)
    }
    return out
  }
  return value
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function resolveOrg(db: Database, org: string): Promise<{ id: string; name: string }> {
  const byId = await db.query.Organization.findFirst({
    where: (t, { eq: is }) => is(t.id, org),
    columns: { id: true, name: true },
  })
  if (byId) return { id: byId.id, name: byId.name ?? '' }
  const byName = await db.query.Organization.findMany({
    where: (t, { ilike }) => ilike(t.name, org),
    columns: { id: true, name: true },
    limit: 2,
  })
  if (byName.length !== 1 || !byName[0])
    throw new Error(`'${org}' matches ${byName.length} organizations by id or name`)
  return { id: byName[0].id, name: byName[0].name ?? '' }
}

async function main() {
  const outPath = arg('--out')
  if (!outPath) {
    console.error('usage: dump-line-parity.ts --out <file> [--org <id|name>] [--source module]')
    process.exit(1)
  }
  const db = database
  const org = await resolveOrg(db, arg('--org') ?? 'DemoOrg1')
  const organizationId = org.id
  const userId = await getOrgCache().get(organizationId, 'systemUser')

  const paymentsLive = isPaymentsConnected(await getPaymentAccount(organizationId))
  const tokenCtx = await systemFields(db, organizationId, 'invoice', ['invoice_public_token'])
  const invoicesWithToken = new Set<string>()
  if (paymentsLive && tokenCtx) {
    for (const r of await readSystemRecords(db, organizationId, tokenCtx)) {
      if (r.text('invoice_public_token')) invoicesWithToken.add(r.id)
    }
  }
  const invoiceTokenSafe = (id: string) => !paymentsLive || invoicesWithToken.has(id)

  const kinds: Record<string, unknown> = {}
  for (const documentType of LINE_DOCUMENT_TYPES) {
    const documentIds = await listDocumentIds(db, organizationId, documentType)
    const totals = await readHeaderTotals(db, organizationId, documentType, documentIds)
    const documents: Record<string, unknown> = {}
    let lineCount = 0
    for (const documentId of documentIds) {
      const lines = await readLinesForDocument(db, organizationId, documentType, documentId)
      lineCount += lines.length
      const doc: Record<string, unknown> = {
        lines,
        headerTotals: totals.get(documentId) ?? null,
        pdf: await readPdfLines(organizationId, userId, documentType, documentId, invoiceTokenSafe),
        editSnapshotLines: await readSnapshotLines(
          db,
          organizationId,
          userId,
          documentType,
          documentId
        ),
      }
      if (documentType === 'work_order') {
        const visitLines = (
          await readParentedLines(db, organizationId, documentType, documentId)
        ).filter((l) => l.visitId !== null)
        doc.visitLines = visitLines
      }
      documents[documentId] = doc
    }
    kinds[documentType] = { documentCount: documentIds.length, lineCount, documents }
    console.log(`${documentType}: ${documentIds.length} documents, ${lineCount} lines`)
  }

  const dump = {
    organizationId,
    organizationName: org.name,
    docsPerKind: DOCS_PER_KIND,
    kinds,
    diagnostics: await readDiagnostics(db, organizationId),
  }
  writeFileSync(outPath, `${JSON.stringify(stable(dump), null, 2)}\n`)
  console.log(`wrote ${outPath}`)
}

main()
  .then(async () => {
    await closePools()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error(error)
    await closePools()
    process.exit(1)
  })
