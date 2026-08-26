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
 * folded into that quote's totals. Exported so the finalize integrity passes
 * (`events/handlers/finalize-integrity-passes.ts`) can match manifest change keys
 * against the exact same trigger vocabulary as this hook.
 */
export const LINE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'line_item_qty',
  'line_item_unit_price',
  'line_item_taxable',
  'line_item_discount',
  'line_item_optional', // selection toggles a line's contribution, not its own total (plan 18 §2)
  'line_item_optional_selected',
  'line_item_quote',
  'line_item_work_order',
  'line_item_invoice', // attach/detach recomputes the invoice (money MI1 build spec §G.1)
  'line_item_order', // attach/detach recomputes the order (08 §5.4)
])

/** Subset of {@link LINE_TRIGGER_ATTRS} that also requires rewriting `line_item_line_total`. */
export const LINE_TOTAL_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'line_item_qty',
  'line_item_unit_price',
])

/** Fields on `quotes` whose write should trigger a recompute (money MQ1 build spec §F.2). */
export const QUOTE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'quote_discount_type',
  'quote_discount_value',
  'quote_tax_rate',
])

/** Fields on `invoices` whose write should trigger a recompute (money MI1 build spec §G.1). */
export const INVOICE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'invoice_discount_type',
  'invoice_discount_value',
  'invoice_tax_rate',
])

/** Fields on `orders` whose write should trigger a recompute (08 §5.4). */
export const ORDER_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'order_discount_type',
  'order_discount_value',
  'order_tax_rate',
])

/** The three **totalled** money documents. `work_order` owns lines but stores no totals. */
type TotalledDocumentType = 'quote' | 'invoice' | 'order'

/**
 * Per-document knobs for {@link recomputeDocumentTotals} (08 §5.4). Everything else —
 * the billing read, the line read, `computeDocumentTotals`, the mirror write — is shared,
 * and the systemAttribute names are all derived from `attrPrefix`.
 */
interface DocumentTotalsSpec {
  /** systemAttribute + field-id prefix: `quote_discount_type`, `quote_subtotal`, … */
  attrPrefix: TotalledDocumentType
  /** The line's owning relation, as a resource field id. */
  lineRelFieldId: string
  /** Extra conditions ANDed onto the line query. */
  extraLineConditions: Array<{
    id: string
    fieldId: string
    operator: 'is' | 'empty'
    value: string | null
  }>
  /**
   * Passed straight through to `setValuesForEntity`. `true` forces a publish (the
   * builder's totals footer updates via realtime); **`undefined` is not the same as
   * `false`** — undefined means "publish unless the session is declared silent"
   * (`field-value-mutations.ts:2667`), which is what the invoice path has always done.
   */
  publishEvents?: boolean
  /** Optional trailing side effect, run after the mirrors are written. */
  afterWrite?: (params: {
    organizationId: string
    userId: string
    documentInstanceId: string
    db?: Database
  }) => Promise<void>
}

const DOCUMENT_TOTALS_SPECS: Record<TotalledDocumentType, DocumentTotalsSpec> = {
  quote: {
    attrPrefix: 'quote',
    lineRelFieldId: 'line_item:quote',
    extraLineConditions: [],
    publishEvents: true,
  },
  invoice: {
    attrPrefix: 'invoice',
    lineRelFieldId: 'line_item:invoice',
    // The §B.3 invariant: an invoice's own lines never carry a work order, so a WO
    // source line stamped with `line_item_invoice` must not contribute twice.
    extraLineConditions: [
      {
        id: 'invoice-lines-workorder',
        fieldId: 'line_item:workOrder',
        operator: 'empty',
        value: null,
      },
    ],
    // Deliberately left undefined — see the field doc above.
    // A total change can move `balance` and flip `paid` ↔ `partially_paid` even
    // though no payment was recorded (§E.4).
    afterWrite: ({ organizationId, userId, documentInstanceId, db }) =>
      syncInvoicePaymentState({
        organizationId,
        userId,
        invoiceInstanceId: documentInstanceId,
        db,
      }),
  },
  order: {
    attrPrefix: 'order',
    lineRelFieldId: 'line_item:order',
    // The plainest of the three: no work-order exclusion (that invariant is about an
    // invoice's own lines) and no payment ledger (08 §5.4).
    extraLineConditions: [],
    publishEvents: true,
  },
}

/**
 * Recompute a totalled document's `subtotal`/`taxTotal`/`total` from its current lines +
 * billing fields and write the mirrors via `FieldValueService`. The single source of truth
 * for "what are this document's totals right now" — called by both the field-change hooks
 * below and the `money.recomputeTotals` router mutation (delete path + drift escape,
 * §F.2/§G.2).
 *
 * Generalized across quote/invoice/order (08 §5.4): the quote and invoice branches were
 * ~110-line near-duplicates differing in three places, which {@link DOCUMENT_TOTALS_SPECS}
 * now names explicitly. The legacy `{ quoteInstanceId }` shape (no `documentType`/
 * `documentInstanceId`) is still accepted so existing quote call sites keep compiling.
 */
export async function recomputeTotals(
  input: RecomputeTotalsInput & { db?: Database }
): Promise<void> {
  const { organizationId, userId } = input
  const documentType = input.documentType ?? 'quote'
  const documentInstanceId = input.documentInstanceId ?? input.quoteInstanceId
  if (!documentInstanceId) {
    throw new BadRequestError(
      'recomputeTotals requires a documentInstanceId (or legacy quoteInstanceId)'
    )
  }

  await recomputeDocumentTotals({
    organizationId,
    userId,
    documentType,
    documentInstanceId,
    db: input.db,
  })
}

/** The one parameterized recompute behind every document type. */
async function recomputeDocumentTotals(params: {
  organizationId: string
  userId: string
  documentType: TotalledDocumentType
  documentInstanceId: string
  db?: Database
}): Promise<void> {
  const { organizationId, userId, documentType, documentInstanceId, db } = params
  const spec = DOCUMENT_TOTALS_SPECS[documentType]
  const documentRecordId = toRecordId(documentType, documentInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId, db)
  const cache = getOrgCache()

  const discountTypeAttr = `${spec.attrPrefix}_discount_type` as SystemAttribute
  const discountValueAttr = `${spec.attrPrefix}_discount_value` as SystemAttribute
  const taxRateAttr = `${spec.attrPrefix}_tax_rate` as SystemAttribute

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([
      discountTypeAttr,
      discountValueAttr,
      taxRateAttr,
      'line_item_line_total',
      'line_item_taxable',
      'line_item_optional',
      'line_item_optional_selected',
    ])

  const discountTypeField = cf[discountTypeAttr]
  const discountValueField = cf[discountValueAttr]
  const taxRateField = cf[taxRateAttr]

  const billingFieldIds = [discountTypeField, discountValueField, taxRateField]
    .filter(Boolean)
    .map((f) => f!.id)
  const billingValues = await handler.getFieldValues(documentRecordId, billingFieldIds)

  const discountTypeTyped = discountTypeField
    ? firstTyped(billingValues.get(discountTypeField.id))
    : undefined
  const discountValueTyped = discountValueField
    ? firstTyped(billingValues.get(discountValueField.id))
    : undefined
  const taxRateTyped = taxRateField ? firstTyped(billingValues.get(taxRateField.id)) : undefined

  const billing: DocumentBillingInputs = {
    discountType: discountTypeTyped ? (extractValue(discountTypeTyped) as DiscountType) : null,
    discountValue: discountValueTyped ? (extractValue(discountValueTyped) as number) : null,
    taxRate: taxRateTyped ? (extractValue(taxRateTyped) as number) : null,
  }

  const { ids: lineInstanceIds } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: `${documentType}-lines`,
        logicalOperator: 'AND',
        conditions: [
          {
            id: `${documentType}-lines-parent`,
            fieldId: spec.lineRelFieldId,
            operator: 'is',
            value: documentRecordId,
          },
          ...spec.extraLineConditions,
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
    recordId: documentRecordId,
    values: [
      { fieldId: `${spec.attrPrefix}_subtotal`, value: totals.subtotal },
      { fieldId: `${spec.attrPrefix}_tax_total`, value: totals.taxTotal },
      { fieldId: `${spec.attrPrefix}_total`, value: totals.total },
    ],
    publishEvents: spec.publishEvents,
  })

  await spec.afterWrite?.({ organizationId, userId, documentInstanceId, db })
}

/**
 * Recompute + write a single line's `line_item_line_total` from its current qty/unitPrice
 * (`publishEvents` ON — the builder's lineTotal cell updates via realtime). Extracted from
 * {@link recomputeOnLineChange} step 1 so the finalize integrity passes can run it per
 * imported/synced line; behavior is identical to the hook's inline version. No-ops when the
 * org lacks the qty/unitPrice fields.
 */
export async function recomputeLineTotal(params: {
  organizationId: string
  userId: string
  lineInstanceId: string
}): Promise<void> {
  const { organizationId, userId, lineInstanceId } = params
  const lineRecordId = toRecordId('line_item', lineInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId)

  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['line_item_qty', 'line_item_unit_price'] as const)
  if (!cf.line_item_qty || !cf.line_item_unit_price) return

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

/**
 * Resolve which document a line's contribution folds into — the parent quote, else the
 * parent invoice but ONLY when `line_item_work_order` is empty (§B.3/§G.1: a WO source
 * line stamped with `line_item_invoice` must never recompute the invoice; only the
 * invoice's own copies do). Extracted from {@link recomputeOnLineChange} steps 2-3 —
 * same reads, same precedence — so the finalize integrity passes can collect DISTINCT
 * parents across a run before recomputing each once. Returns null when the line hangs
 * off no recomputable document.
 */
export async function resolveLineParentDocument(params: {
  organizationId: string
  userId: string
  lineInstanceId: string
}): Promise<{ documentType: TotalledDocumentType; documentInstanceId: string } | null> {
  const { organizationId, userId, lineInstanceId } = params
  const lineRecordId = toRecordId('line_item', lineInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId)

  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'line_item_quote',
      'line_item_invoice',
      'line_item_order',
      'line_item_work_order',
    ] as const)

  // Resolve the parent quote — work_order lines have no stored totals in MQ1, skip.
  if (cf.line_item_quote) {
    const quoteValues = await handler.getFieldValues(lineRecordId, [cf.line_item_quote.id])
    const quoteTyped = firstTyped(quoteValues.get(cf.line_item_quote.id))
    if (quoteTyped?.type === 'relationship' && quoteTyped.recordId) {
      const { entityInstanceId: quoteInstanceId } = parseRecordId(quoteTyped.recordId)
      return { documentType: 'quote', documentInstanceId: quoteInstanceId }
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
      return { documentType: 'invoice', documentInstanceId: invoiceInstanceId }
    }
  }

  // Resolve the parent order (08 §5.4). Last in precedence because it is the newest
  // slot and the only one a line can hold alongside nothing else — an order line is
  // never also a quote or invoice line.
  if (cf.line_item_order) {
    const orderValues = await handler.getFieldValues(lineRecordId, [cf.line_item_order.id])
    const orderTyped = firstTyped(orderValues.get(cf.line_item_order.id))
    if (orderTyped?.type === 'relationship' && orderTyped.recordId) {
      const { entityInstanceId: orderInstanceId } = parseRecordId(orderTyped.recordId)
      return { documentType: 'order', documentInstanceId: orderInstanceId }
    }
  }

  return null
}

/**
 * Recompute hook for `line-items` (money MQ1 build spec §F.2, registered under the
 * `line-items` apiSlug in `field-hooks/register-hooks.ts`). Steps:
 *
 * 1. If `qty`/`unitPrice` changed, recompute + write `line_item_line_total`
 *    ({@link recomputeLineTotal}).
 * 2. Resolve the line's parent document ({@link resolveLineParentDocument}: quote first,
 *    else invoice-without-work-order) and recompute+write its mirrored totals.
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

  if (LINE_TOTAL_TRIGGER_ATTRS.has(attr)) {
    await recomputeLineTotal({ organizationId, userId, lineInstanceId })
  }

  const parent = await resolveLineParentDocument({ organizationId, userId, lineInstanceId })
  if (parent) {
    await recomputeTotals({
      organizationId,
      userId,
      documentType: parent.documentType,
      documentInstanceId: parent.documentInstanceId,
    })
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

/**
 * Recompute hook for `orders` (08 §5.4, registered under the `orders` apiSlug). Fires when
 * the order's own billing fields change (discount type/value, tax rate) and recomputes +
 * writes its mirrored totals.
 */
export const recomputeOnOrderBillingChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !ORDER_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId: orderInstanceId } = parseRecordId(event.recordId)
  await recomputeTotals({
    organizationId: event.organizationId,
    userId: event.userId,
    documentType: 'order',
    documentInstanceId: orderInstanceId,
  })
}
