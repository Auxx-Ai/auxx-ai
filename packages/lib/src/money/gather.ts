// packages/lib/src/money/gather.ts

import { database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { inArray } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import { FieldValueService } from '../field-values/field-value-service'
import { UnifiedCrudHandler } from '../resources/crud'
import { getOrganizationSetting } from '../settings/settings-service'
import { recomputeTotals } from './totals-hooks'
import type {
  CreateInvoiceFromWorkOrderInput,
  CreateInvoiceFromWorkOrderResult,
  DeleteInvoiceLineInput,
  DiscountType,
  ListUninvoicedLinesInput,
  UninvoicedLine,
} from './types'

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

const LINE_ROW_ATTRS = [
  'line_item_name',
  'line_item_description',
  'line_item_qty',
  'line_item_unit_price',
  'line_item_line_total',
  'line_item_taxable',
  'line_item_visit_id',
  'line_item_invoice',
] as const

const LINE_COPY_ATTRS = [
  'line_item_name',
  'line_item_description',
  'line_item_qty',
  'line_item_unit_price',
  'line_item_line_total',
  'line_item_taxable',
  'line_item_category',
  'line_item_discount',
  'line_item_sort_order',
  'line_item_catalog_item',
  'line_item_work_order',
  'line_item_invoice',
] as const

/**
 * List a work order's lines not yet stamped onto any invoice (money MI1 build spec §G.3) —
 * the gather dialog's data source. Sorted by `sortOrder`. Defensive backstop: a line whose
 * `line_item_invoice` stamp points at an `EntityInstance` that no longer exists (any delete
 * path that slipped past `deleteInvoice`/`voidInvoice`'s unstamp step) is treated as
 * uninvoiced too — heals orphaned stamps instead of hiding the line forever.
 */
export async function listUninvoicedLines(
  input: ListUninvoicedLinesInput
): Promise<UninvoicedLine[]> {
  const { organizationId, userId, workOrderInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()
  const workOrderRecordId = toRecordId('work_order', workOrderInstanceId)

  const { ids: lineInstanceIds } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'wo-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'wo-lines-workorder',
            fieldId: 'line_item:workOrder',
            operator: 'is',
            value: workOrderRecordId,
          },
        ],
      },
    ],
    sorting: [{ id: 'sortOrder', desc: false }],
    limit: 1000,
    mode: 'oneshot',
  })
  if (lineInstanceIds.length === 0) return []

  const cf = await cache.from(organizationId, 'customFields').bySystemAttributes(LINE_ROW_ATTRS)
  const fieldIds = Object.values(cf)
    .filter(Boolean)
    .map((f) => f!.id)

  type RawRow = {
    lineInstanceId: string
    invoiceInstanceId: string | undefined
    name: string
    description: string | undefined
    qty: number
    unitPrice: number | null
    lineTotal: number | null
    taxable: boolean
    visitId: string | undefined
  }

  const rawRows: RawRow[] = []
  for (const lineInstanceId of lineInstanceIds) {
    const lineRecordId = toRecordId('line_item', lineInstanceId)
    const values = await handler.getFieldValues(lineRecordId, fieldIds)
    const get = (f?: { id: string }) => (f ? firstTyped(values.get(f.id)) : undefined)

    const invoiceTyped = get(cf.line_item_invoice)
    const invoiceRecordId =
      invoiceTyped?.type === 'relationship' ? invoiceTyped.recordId : undefined
    const invoiceInstanceId = invoiceRecordId
      ? parseRecordId(invoiceRecordId).entityInstanceId
      : undefined

    const nameTyped = get(cf.line_item_name)
    const descriptionTyped = get(cf.line_item_description)
    const qtyTyped = get(cf.line_item_qty)
    const unitPriceTyped = get(cf.line_item_unit_price)
    const lineTotalTyped = get(cf.line_item_line_total)
    const taxableTyped = get(cf.line_item_taxable)
    const visitIdTyped = get(cf.line_item_visit_id)

    rawRows.push({
      lineInstanceId,
      invoiceInstanceId,
      name: nameTyped ? (extractValue(nameTyped) as string) : '',
      description: descriptionTyped ? (extractValue(descriptionTyped) as string) : undefined,
      qty: qtyTyped ? (extractValue(qtyTyped) as number) : 1,
      unitPrice: unitPriceTyped ? (extractValue(unitPriceTyped) as number) : null,
      lineTotal: lineTotalTyped ? (extractValue(lineTotalTyped) as number) : null,
      taxable: taxableTyped ? (extractValue(taxableTyped) as boolean) : true,
      visitId: visitIdTyped ? (extractValue(visitIdTyped) as string) : undefined,
    })
  }

  // Batch-check which stamped invoice ids still exist — one query for the backstop.
  const stampedInvoiceIds = [
    ...new Set(rawRows.map((r) => r.invoiceInstanceId).filter(Boolean)),
  ] as string[]
  const existingInvoiceIds = stampedInvoiceIds.length
    ? new Set(
        (
          await database.query.EntityInstance.findMany({
            where: inArray(schema.EntityInstance.id, stampedInvoiceIds),
            columns: { id: true },
          })
        ).map((row) => row.id)
      )
    : new Set<string>()

  return rawRows
    .filter((row) => !row.invoiceInstanceId || !existingInvoiceIds.has(row.invoiceInstanceId))
    .map((row) => ({
      recordId: toRecordId('line_item', row.lineInstanceId),
      instanceId: row.lineInstanceId,
      name: row.name,
      description: row.description,
      qty: row.qty,
      unitPrice: row.unitPrice,
      lineTotal: row.lineTotal,
      taxable: row.taxable,
      visitId: row.visitId,
    }))
}

/**
 * Gather selected work-order lines onto a new invoice (money MI1 build spec §G.3). Whole-line
 * only (decision 7) — checked lines are copied verbatim, never split. Billing (discount/tax)
 * is inherited from the work order's linked quote snapshot when present, else the org's
 * default tax rate (`documents.taxRates`, the `isDefault` entry) with no discount. Source
 * lines are stamped with `line_item_invoice` (the "invoiced by" pointer, §B.3) — they are
 * NOT moved or duplicated onto the work order's own line set, which stays as-is.
 *
 * @returns `{ recordId, instanceId }` — the client opens `/app/invoices?id=<instanceId>`.
 */
export async function createInvoiceFromWorkOrder(
  input: CreateInvoiceFromWorkOrderInput
): Promise<CreateInvoiceFromWorkOrderResult> {
  const { organizationId, userId, workOrderInstanceId, lineInstanceIds } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()
  const workOrderRecordId = toRecordId('work_order', workOrderInstanceId)

  // ─── Step 1: contact + linked quote ─────────────────────────────────────────
  const woCf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['work_order_contact', 'work_order_quote'] as const)
  const woFieldIds = [woCf.work_order_contact, woCf.work_order_quote]
    .filter(Boolean)
    .map((f) => f!.id)
  const woValues = await handler.getFieldValues(workOrderRecordId, woFieldIds)

  const contactTyped = woCf.work_order_contact
    ? firstTyped(woValues.get(woCf.work_order_contact.id))
    : undefined
  const contactRecordId = contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined
  if (!contactRecordId) {
    throw new BadRequestError('Add a contact to this job before invoicing')
  }

  const quoteTyped = woCf.work_order_quote
    ? firstTyped(woValues.get(woCf.work_order_quote.id))
    : undefined
  const quoteRecordId = quoteTyped?.type === 'relationship' ? quoteTyped.recordId : undefined

  // ─── Step 2: billing inheritance ────────────────────────────────────────────
  let discountType: DiscountType | null = null
  let discountValue: number | null = null
  let taxName: string | null = null
  let taxRate: number | null = null

  if (quoteRecordId) {
    const quoteCf = await cache
      .from(organizationId, 'customFields')
      .bySystemAttributes([
        'quote_discount_type',
        'quote_discount_value',
        'quote_tax_name',
        'quote_tax_rate',
      ] as const)
    const quoteFieldIds = [
      quoteCf.quote_discount_type,
      quoteCf.quote_discount_value,
      quoteCf.quote_tax_name,
      quoteCf.quote_tax_rate,
    ]
      .filter(Boolean)
      .map((f) => f!.id)
    const quoteValues = await handler.getFieldValues(quoteRecordId, quoteFieldIds)
    const get = (f?: { id: string }) => (f ? firstTyped(quoteValues.get(f.id)) : undefined)

    const discountTypeTyped = get(quoteCf.quote_discount_type)
    const discountValueTyped = get(quoteCf.quote_discount_value)
    const taxNameTyped = get(quoteCf.quote_tax_name)
    const taxRateTyped = get(quoteCf.quote_tax_rate)

    discountType = discountTypeTyped ? (extractValue(discountTypeTyped) as DiscountType) : null
    discountValue = discountValueTyped ? (extractValue(discountValueTyped) as number) : null
    taxName = taxNameTyped ? (extractValue(taxNameTyped) as string) : null
    taxRate = taxRateTyped ? (extractValue(taxRateTyped) as number) : null
  } else {
    const taxRates = (await getOrganizationSetting({
      organizationId,
      key: 'documents.taxRates',
    })) as Array<{ id: string; name: string; rate: number; isDefault?: boolean }> | null
    const defaultRate = taxRates?.find((rate) => rate.isDefault)
    if (defaultRate) {
      taxName = defaultRate.name
      taxRate = defaultRate.rate
    }
  }

  // ─── Step 3: create the invoice ─────────────────────────────────────────────
  const dueDays = await getOrganizationSetting({ organizationId, key: 'documents.invoice.dueDays' })
  const today = new Date()
  const dueDate = new Date(today.getTime() + Number(dueDays ?? 30) * 24 * 60 * 60 * 1000)

  const invoiceValues: Record<string, unknown> = {
    invoice_contact: contactRecordId,
    invoice_work_order: workOrderRecordId,
    invoice_issued_at: today.toISOString().split('T')[0],
    invoice_due_date: dueDate.toISOString().split('T')[0],
  }
  if (discountType) invoiceValues.invoice_discount_type = discountType
  if (discountValue !== null) invoiceValues.invoice_discount_value = discountValue
  if (taxName) invoiceValues.invoice_tax_name = taxName
  if (taxRate !== null) invoiceValues.invoice_tax_rate = taxRate

  const createdInvoice = await handler.create('invoice', invoiceValues)
  const invoiceRecordId = createdInvoice.recordId
  const invoiceInstanceId = createdInvoice.instance.id

  // ─── Step 4: re-validate requested lines (concurrency guard) ───────────────
  const lineCf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(LINE_COPY_ATTRS)
  const lineFieldIds = Object.values(lineCf)
    .filter(Boolean)
    .map((f) => f!.id)

  const validLineInstanceIds: string[] = []
  for (const lineInstanceId of lineInstanceIds) {
    const lineRecordId = toRecordId('line_item', lineInstanceId)
    const values = await handler.getFieldValues(lineRecordId, lineFieldIds)
    const get = (f?: { id: string }) => (f ? firstTyped(values.get(f.id)) : undefined)

    // Compare underlying instance ids, not RecordId strings: `getFieldValues` returns
    // relationship values stamped with the target's raw `EntityDefinition.id`, while
    // `workOrderRecordId` above is built with the `work_order` type slug — the two strings
    // never compare equal even when they point at the same work order.
    const lineWorkOrderTyped = get(lineCf.line_item_work_order)
    const lineWorkOrderInstanceId =
      lineWorkOrderTyped?.type === 'relationship' && lineWorkOrderTyped.recordId
        ? parseRecordId(lineWorkOrderTyped.recordId).entityInstanceId
        : undefined
    if (lineWorkOrderInstanceId !== workOrderInstanceId) continue // not this WO's line

    const invoiceTyped = get(lineCf.line_item_invoice)
    if (invoiceTyped?.type === 'relationship' && invoiceTyped.recordId) continue // already stamped

    validLineInstanceIds.push(lineInstanceId)
  }

  // ─── Steps 5–6: copy each source line, then stamp it as gathered ───────────
  const fieldValueService = new FieldValueService(organizationId, userId)
  for (const lineInstanceId of validLineInstanceIds) {
    const lineRecordId = toRecordId('line_item', lineInstanceId)
    const values = await handler.getFieldValues(lineRecordId, lineFieldIds)
    const get = (f?: { id: string }) => (f ? firstTyped(values.get(f.id)) : undefined)

    const nameTyped = get(lineCf.line_item_name)
    const descriptionTyped = get(lineCf.line_item_description)
    const qtyTyped = get(lineCf.line_item_qty)
    const unitPriceTyped = get(lineCf.line_item_unit_price)
    const lineTotalTyped = get(lineCf.line_item_line_total)
    const taxableTyped = get(lineCf.line_item_taxable)
    const categoryTyped = get(lineCf.line_item_category)
    const discountTyped = get(lineCf.line_item_discount)
    const sortOrderTyped = get(lineCf.line_item_sort_order)
    const catalogItemTyped = get(lineCf.line_item_catalog_item)

    // No `line_item_work_order`, no `line_item_quote` on copies (§B.3 invariant).
    const copyValues: Record<string, unknown> = {
      line_item_name: nameTyped ? extractValue(nameTyped) : undefined,
      line_item_description: descriptionTyped ? extractValue(descriptionTyped) : undefined,
      line_item_qty: qtyTyped ? extractValue(qtyTyped) : 1,
      line_item_unit_price: unitPriceTyped ? extractValue(unitPriceTyped) : undefined,
      line_item_line_total: lineTotalTyped ? extractValue(lineTotalTyped) : undefined,
      line_item_taxable: taxableTyped ? extractValue(taxableTyped) : true,
      line_item_category: categoryTyped ? extractValue(categoryTyped) : undefined,
      line_item_discount: discountTyped ? extractValue(discountTyped) : undefined,
      line_item_sort_order: sortOrderTyped ? extractValue(sortOrderTyped) : undefined,
      line_item_invoice: invoiceRecordId,
      line_item_source_line_id: lineInstanceId,
    }
    if (catalogItemTyped?.type === 'relationship') {
      copyValues.line_item_catalog_item = catalogItemTyped.recordId
    }

    await handler.create('line_item', copyValues)

    // Stamp the source ("invoiced by" pointer) — publishEvents ON so visit chips/job view
    // update live; the §G.1 guard keeps this from recomputing invoice totals (source lines
    // still carry `line_item_work_order`).
    await fieldValueService.setValuesForEntity({
      recordId: lineRecordId,
      values: [{ fieldId: 'line_item_invoice', value: invoiceRecordId }],
    })
  }

  // ─── Step 7: totals (also seeds balance = total via the ledger sync) ──────
  await recomputeTotals({
    organizationId,
    userId,
    documentType: 'invoice',
    documentInstanceId: invoiceInstanceId,
  })

  // ─── Step 8: return ─────────────────────────────────────────────────────────
  return { recordId: invoiceRecordId, instanceId: invoiceInstanceId }
}

/**
 * Delete a single line from a draft invoice (money MI1 build spec §G.3). If the line carries
 * `sourceLineId` (a gather copy), clears the source's `line_item_invoice` stamp so it becomes
 * uninvoiced again (decision 5). Then deletes the line and recomputes the invoice's totals.
 */
export async function deleteInvoiceLine(input: DeleteInvoiceLineInput): Promise<void> {
  const { organizationId, userId, lineInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()
  const lineRecordId = toRecordId('line_item', lineInstanceId)

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['line_item_invoice', 'line_item_source_line_id'] as const)
  const fieldIds = [cf.line_item_invoice, cf.line_item_source_line_id]
    .filter(Boolean)
    .map((f) => f!.id)
  const values = await handler.getFieldValues(lineRecordId, fieldIds)

  const invoiceTyped = cf.line_item_invoice
    ? firstTyped(values.get(cf.line_item_invoice.id))
    : undefined
  const invoiceRecordId = invoiceTyped?.type === 'relationship' ? invoiceTyped.recordId : undefined
  if (!invoiceRecordId) {
    throw new BadRequestError('This line is not an invoice line')
  }
  const { entityInstanceId: invoiceInstanceId } = parseRecordId(invoiceRecordId)

  const invoiceCf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['invoice_status'] as const)
  const statusFieldIds = invoiceCf.invoice_status ? [invoiceCf.invoice_status.id] : []
  const invoiceValues = await handler.getFieldValues(invoiceRecordId, statusFieldIds)
  const statusTyped = invoiceCf.invoice_status
    ? firstTyped(invoiceValues.get(invoiceCf.invoice_status.id))
    : undefined
  const status = statusTyped ? (extractValue(statusTyped) as string) : undefined
  if (status !== 'draft') {
    throw new BadRequestError(
      `Cannot delete a line — invoice must be 'draft' (currently '${status ?? 'unknown'}')`
    )
  }

  const sourceLineIdTyped = cf.line_item_source_line_id
    ? firstTyped(values.get(cf.line_item_source_line_id.id))
    : undefined
  const sourceLineInstanceId = sourceLineIdTyped
    ? (extractValue(sourceLineIdTyped) as string)
    : undefined

  if (sourceLineInstanceId) {
    const fieldValueService = new FieldValueService(organizationId, userId)
    await fieldValueService.setValuesForEntity({
      recordId: toRecordId('line_item', sourceLineInstanceId),
      values: [{ fieldId: 'line_item_invoice', value: null }],
    })
  }

  await handler.delete(lineRecordId)

  await recomputeTotals({
    organizationId,
    userId,
    documentType: 'invoice',
    documentInstanceId: invoiceInstanceId,
  })
}
