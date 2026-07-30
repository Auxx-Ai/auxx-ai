// packages/lib/src/money/totals-hooks.ts

import type { Database } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import type { EntityFieldChangeHandler } from '../field-hooks/types'
import { FieldValueService } from '../field-values/field-value-service'
import { UnifiedCrudHandler } from '../resources/crud'
import { syncInvoicePaymentState } from './payments/ledger'
import { computeDocumentTotals, computeLineTotal } from './totals'
import type {
  DiscountType,
  DocumentBillingInputs,
  LineForTotals,
  RecomputeTotalsInput,
} from './types'

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Fields on `line-items` whose write should trigger a recompute (money MQ1 build
 * spec §F.2). The rel triggers (`line_item_quote` / `line_item_work_order`) catch
 * attach/detach side effects — a line just linked to a quote needs its contribution
 * folded into that quote's totals.
 */
const LINE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'line_item_qty',
  'line_item_unit_price',
  'line_item_taxable',
  'line_item_discount',
  'line_item_optional', // selection toggles a line's contribution, not its own total (plan 18 §2)
  'line_item_optional_selected',
  'line_item_quote',
  'line_item_work_order',
  'line_item_invoice', // attach/detach recomputes the invoice (money MI1 build spec §G.1)
])

/** Subset of {@link LINE_TRIGGER_ATTRS} that also requires rewriting `line_item_line_total`. */
const LINE_TOTAL_TRIGGER_ATTRS = new Set<SystemAttribute>(['line_item_qty', 'line_item_unit_price'])

/** Fields on `quotes` whose write should trigger a recompute (money MQ1 build spec §F.2). */
const QUOTE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'quote_discount_type',
  'quote_discount_value',
  'quote_tax_rate',
])

/** Fields on `invoices` whose write should trigger a recompute (money MI1 build spec §G.1). */
const INVOICE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'invoice_discount_type',
  'invoice_discount_value',
  'invoice_tax_rate',
])

/**
 * Recompute a document's (quote or invoice) `subtotal`/`taxTotal`/`total` from its current
 * lines + billing fields and write the mirrors via `FieldValueService`. The single source of
 * truth for "what are this document's totals right now" — called by both field-change hooks
 * below and the `money.recomputeTotals` router mutation (delete path + drift escape,
 * §F.2/§G.2). Generalized across document types (money MI1 build spec §G.1) — the legacy
 * `{ quoteInstanceId }` shape (no `documentType`/`documentInstanceId`) is still accepted so
 * existing quote call sites keep compiling unchanged.
 */
export async function recomputeTotals(
  input: RecomputeTotalsInput & { db?: Database; publishEvents?: boolean }
): Promise<void> {
  const { organizationId, userId } = input
  const documentType = input.documentType ?? 'quote'
  const documentInstanceId = input.documentInstanceId ?? input.quoteInstanceId
  if (!documentInstanceId) {
    throw new BadRequestError(
      'recomputeTotals requires a documentInstanceId (or legacy quoteInstanceId)'
    )
  }

  if (documentType === 'invoice') {
    await recomputeInvoiceTotals({
      organizationId,
      userId,
      invoiceInstanceId: documentInstanceId,
      db: input.db,
      publishEvents: input.publishEvents,
    })
    return
  }

  await recomputeQuoteTotals({ organizationId, userId, quoteInstanceId: documentInstanceId })
}

/** Quote branch of {@link recomputeTotals} — the original MQ1 engine, unchanged. */
async function recomputeQuoteTotals(params: {
  organizationId: string
  userId: string
  quoteInstanceId: string
}): Promise<void> {
  const { organizationId, userId, quoteInstanceId } = params
  const quoteRecordId = toRecordId('quote', quoteInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'quote_discount_type',
      'quote_discount_value',
      'quote_tax_rate',
      'line_item_line_total',
      'line_item_taxable',
      'line_item_optional',
      'line_item_optional_selected',
    ] as const)

  const billingFieldIds = [cf.quote_discount_type, cf.quote_discount_value, cf.quote_tax_rate]
    .filter(Boolean)
    .map((f) => f!.id)
  const billingValues = await handler.getFieldValues(quoteRecordId, billingFieldIds)

  const discountTypeTyped = cf.quote_discount_type
    ? firstTyped(billingValues.get(cf.quote_discount_type.id))
    : undefined
  const discountValueTyped = cf.quote_discount_value
    ? firstTyped(billingValues.get(cf.quote_discount_value.id))
    : undefined
  const taxRateTyped = cf.quote_tax_rate
    ? firstTyped(billingValues.get(cf.quote_tax_rate.id))
    : undefined

  const billing: DocumentBillingInputs = {
    discountType: discountTypeTyped ? (extractValue(discountTypeTyped) as DiscountType) : null,
    discountValue: discountValueTyped ? (extractValue(discountValueTyped) as number) : null,
    taxRate: taxRateTyped ? (extractValue(taxRateTyped) as number) : null,
  }

  const { ids: lineInstanceIds } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'quote-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'quote-lines-c1',
            fieldId: 'line_item:quote',
            operator: 'is',
            value: quoteRecordId,
          },
        ],
      },
    ],
    limit: 1000,
  })

  const lines: LineForTotals[] = []
  if (cf.line_item_line_total && cf.line_item_taxable) {
    const lineTotalFieldId = cf.line_item_line_total.id
    const taxableFieldId = cf.line_item_taxable.id
    const optionalFieldId = cf.line_item_optional?.id
    const optionalSelectedFieldId = cf.line_item_optional_selected?.id
    for (const lineInstanceId of lineInstanceIds) {
      const lineRecordId = toRecordId('line_item', lineInstanceId)
      const fieldIds = [lineTotalFieldId, taxableFieldId, optionalFieldId, optionalSelectedFieldId]
        .filter(Boolean)
        .map((id) => id!)
      const lineValues = await handler.getFieldValues(lineRecordId, fieldIds)
      const lineTotalTyped = firstTyped(lineValues.get(lineTotalFieldId))
      const taxableTyped = firstTyped(lineValues.get(taxableFieldId))
      const optionalTyped = optionalFieldId
        ? firstTyped(lineValues.get(optionalFieldId))
        : undefined
      const optionalSelectedTyped = optionalSelectedFieldId
        ? firstTyped(lineValues.get(optionalSelectedFieldId))
        : undefined
      lines.push({
        lineTotal: lineTotalTyped ? (extractValue(lineTotalTyped) as number) : null,
        taxable: taxableTyped ? (extractValue(taxableTyped) as boolean) : true,
        optional: optionalTyped ? (extractValue(optionalTyped) as boolean) : undefined,
        optionalSelected: optionalSelectedTyped
          ? (extractValue(optionalSelectedTyped) as boolean)
          : undefined,
      })
    }
  }

  const totals = computeDocumentTotals(lines, billing)

  const fieldValueService = new FieldValueService(organizationId, userId)
  await fieldValueService.setValuesForEntity({
    recordId: quoteRecordId,
    values: [
      { fieldId: 'quote_subtotal', value: totals.subtotal },
      { fieldId: 'quote_tax_total', value: totals.taxTotal },
      { fieldId: 'quote_total', value: totals.total },
    ],
    publishEvents: true,
  })
}

/**
 * Invoice branch of {@link recomputeTotals} (money MI1 build spec §G.1) — same shape as
 * {@link recomputeQuoteTotals} over `line_item:invoice is X AND line_item:workOrder is empty`
 * (the §B.3 invariant: an invoice's own lines never carry a work order). Ends by calling
 * `syncInvoicePaymentState` — a total change can move `balance` and flip
 * `paid` ↔ `partially_paid` even though no payment was recorded (§E.4).
 */
async function recomputeInvoiceTotals(params: {
  organizationId: string
  userId: string
  invoiceInstanceId: string
  db?: Database
  publishEvents?: boolean
}): Promise<void> {
  const { organizationId, userId, invoiceInstanceId, db, publishEvents = true } = params
  const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId, db)
  const cache = getOrgCache()

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'invoice_discount_type',
      'invoice_discount_value',
      'invoice_tax_rate',
      'line_item_line_total',
      'line_item_taxable',
      'line_item_optional',
      'line_item_optional_selected',
    ] as const)

  const billingFieldIds = [cf.invoice_discount_type, cf.invoice_discount_value, cf.invoice_tax_rate]
    .filter(Boolean)
    .map((f) => f!.id)
  const billingValues = await handler.getFieldValues(invoiceRecordId, billingFieldIds)

  const discountTypeTyped = cf.invoice_discount_type
    ? firstTyped(billingValues.get(cf.invoice_discount_type.id))
    : undefined
  const discountValueTyped = cf.invoice_discount_value
    ? firstTyped(billingValues.get(cf.invoice_discount_value.id))
    : undefined
  const taxRateTyped = cf.invoice_tax_rate
    ? firstTyped(billingValues.get(cf.invoice_tax_rate.id))
    : undefined

  const billing: DocumentBillingInputs = {
    discountType: discountTypeTyped ? (extractValue(discountTypeTyped) as DiscountType) : null,
    discountValue: discountValueTyped ? (extractValue(discountValueTyped) as number) : null,
    taxRate: taxRateTyped ? (extractValue(taxRateTyped) as number) : null,
  }

  const { ids: lineInstanceIds } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'invoice-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'invoice-lines-invoice',
            fieldId: 'line_item:invoice',
            operator: 'is',
            value: invoiceRecordId,
          },
          {
            id: 'invoice-lines-workorder',
            fieldId: 'line_item:workOrder',
            operator: 'empty',
            value: null,
          },
        ],
      },
    ],
    limit: 1000,
  })

  const lines: LineForTotals[] = []
  if (cf.line_item_line_total && cf.line_item_taxable) {
    const lineTotalFieldId = cf.line_item_line_total.id
    const taxableFieldId = cf.line_item_taxable.id
    const optionalFieldId = cf.line_item_optional?.id
    const optionalSelectedFieldId = cf.line_item_optional_selected?.id
    for (const lineInstanceId of lineInstanceIds) {
      const lineRecordId = toRecordId('line_item', lineInstanceId)
      const fieldIds = [lineTotalFieldId, taxableFieldId, optionalFieldId, optionalSelectedFieldId]
        .filter(Boolean)
        .map((id) => id!)
      const lineValues = await handler.getFieldValues(lineRecordId, fieldIds)
      const lineTotalTyped = firstTyped(lineValues.get(lineTotalFieldId))
      const taxableTyped = firstTyped(lineValues.get(taxableFieldId))
      const optionalTyped = optionalFieldId
        ? firstTyped(lineValues.get(optionalFieldId))
        : undefined
      const optionalSelectedTyped = optionalSelectedFieldId
        ? firstTyped(lineValues.get(optionalSelectedFieldId))
        : undefined
      lines.push({
        lineTotal: lineTotalTyped ? (extractValue(lineTotalTyped) as number) : null,
        taxable: taxableTyped ? (extractValue(taxableTyped) as boolean) : true,
        optional: optionalTyped ? (extractValue(optionalTyped) as boolean) : undefined,
        optionalSelected: optionalSelectedTyped
          ? (extractValue(optionalSelectedTyped) as boolean)
          : undefined,
      })
    }
  }

  const totals = computeDocumentTotals(lines, billing)

  const fieldValueService = new FieldValueService(organizationId, userId, db)
  await fieldValueService.setValuesForEntity({
    recordId: invoiceRecordId,
    values: [
      { fieldId: 'invoice_subtotal', value: totals.subtotal },
      { fieldId: 'invoice_tax_total', value: totals.taxTotal },
      { fieldId: 'invoice_total', value: totals.total },
    ],
    publishEvents,
  })

  await syncInvoicePaymentState({
    organizationId,
    userId,
    invoiceInstanceId,
    db,
    publishEvents,
  })
}

/**
 * Recompute hook for `line-items` (money MQ1 build spec §F.2, registered under the
 * `line-items` apiSlug in `field-hooks/register-hooks.ts`). Steps:
 *
 * 1. If `qty`/`unitPrice` changed, recompute + write `line_item_line_total`
 *    (`publishEvents` ON — the builder's lineTotal cell updates via realtime).
 * 2. Resolve the line's parent quote and recompute+write its mirrored totals. Skipped when
 *    there's no `line_item_quote` value.
 * 3. Else resolve the line's parent invoice (money MI1 build spec §G.1) — but ONLY when
 *    `line_item_work_order` is empty. A work-order line stamped with `line_item_invoice`
 *    (the gather "invoiced by" pointer, §B.3) must NEVER recompute the invoice from here;
 *    only the invoice's own copies (workOrder empty) do.
 *
 * No recursion: the fields this hook writes (`line_total`, `subtotal`/`tax_total`/
 * `total`) are not in {@link LINE_TRIGGER_ATTRS}, {@link QUOTE_TRIGGER_ATTRS}, or
 * {@link INVOICE_TRIGGER_ATTRS}, so re-entry exits immediately on the systemAttribute filter.
 */
export const recomputeOnLineChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !LINE_TRIGGER_ATTRS.has(attr)) return

  const { organizationId, userId } = event
  const { entityInstanceId: lineInstanceId } = parseRecordId(event.recordId)
  const lineRecordId = toRecordId('line_item', lineInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'line_item_qty',
      'line_item_unit_price',
      'line_item_quote',
      'line_item_invoice',
      'line_item_work_order',
    ] as const)

  if (LINE_TOTAL_TRIGGER_ATTRS.has(attr) && cf.line_item_qty && cf.line_item_unit_price) {
    const values = await handler.getFieldValues(lineRecordId, [
      cf.line_item_qty.id,
      cf.line_item_unit_price.id,
    ])
    const qtyTyped = firstTyped(values.get(cf.line_item_qty.id))
    const unitPriceTyped = firstTyped(values.get(cf.line_item_unit_price.id))
    const qty = qtyTyped ? (extractValue(qtyTyped) as number) : 0
    const unitPrice = unitPriceTyped ? (extractValue(unitPriceTyped) as number) : null

    const fieldValueService = new FieldValueService(organizationId, userId)
    await fieldValueService.setValuesForEntity({
      recordId: lineRecordId,
      values: [{ fieldId: 'line_item_line_total', value: computeLineTotal(qty, unitPrice) }],
      publishEvents: true,
    })
  }

  // Resolve the parent quote — work_order lines have no stored totals in MQ1, skip.
  if (cf.line_item_quote) {
    const quoteValues = await handler.getFieldValues(lineRecordId, [cf.line_item_quote.id])
    const quoteTyped = firstTyped(quoteValues.get(cf.line_item_quote.id))
    if (quoteTyped?.type === 'relationship' && quoteTyped.recordId) {
      const { entityInstanceId: quoteInstanceId } = parseRecordId(quoteTyped.recordId)
      await recomputeTotals({
        organizationId,
        userId,
        documentType: 'quote',
        documentInstanceId: quoteInstanceId,
      })
      return
    }
  }

  // Resolve the parent invoice — ONLY when this line has no work order (§B.3/§G.1): a
  // WO source line stamped with `line_item_invoice` must never recompute the invoice.
  if (cf.line_item_invoice && cf.line_item_work_order) {
    const relValues = await handler.getFieldValues(lineRecordId, [
      cf.line_item_invoice.id,
      cf.line_item_work_order.id,
    ])
    const invoiceTyped = firstTyped(relValues.get(cf.line_item_invoice.id))
    const workOrderTyped = firstTyped(relValues.get(cf.line_item_work_order.id))
    const hasWorkOrder = workOrderTyped?.type === 'relationship' && !!workOrderTyped.recordId
    if (!hasWorkOrder && invoiceTyped?.type === 'relationship' && invoiceTyped.recordId) {
      const { entityInstanceId: invoiceInstanceId } = parseRecordId(invoiceTyped.recordId)
      await recomputeTotals({
        organizationId,
        userId,
        documentType: 'invoice',
        documentInstanceId: invoiceInstanceId,
      })
    }
  }
}

/**
 * Recompute hook for `quotes` (money MQ1 build spec §F.2, registered under the
 * `quotes` apiSlug). Fires when the quote's own billing fields change
 * (discount type/value, tax rate) and recomputes+writes its mirrored totals.
 */
export const recomputeOnQuoteBillingChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !QUOTE_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId: quoteInstanceId } = parseRecordId(event.recordId)
  await recomputeTotals({
    organizationId: event.organizationId,
    userId: event.userId,
    documentType: 'quote',
    documentInstanceId: quoteInstanceId,
  })
}

/**
 * Recompute hook for `invoices` (money MI1 build spec §G.1, registered under the `invoices`
 * apiSlug). Fires when the invoice's own billing fields change (discount type/value, tax
 * rate) and recomputes+writes its mirrored totals.
 */
export const recomputeOnInvoiceBillingChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !INVOICE_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId: invoiceInstanceId } = parseRecordId(event.recordId)
  await recomputeTotals({
    organizationId: event.organizationId,
    userId: event.userId,
    documentType: 'invoice',
    documentInstanceId: invoiceInstanceId,
  })
}
