// packages/lib/src/money/totals-hooks.ts

import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { getOrgCache } from '../cache'
import type { EntityFieldChangeHandler } from '../field-hooks/types'
import { FieldValueService } from '../field-values/field-value-service'
import { UnifiedCrudHandler } from '../resources/crud'
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
  'line_item_quote',
  'line_item_work_order',
])

/** Subset of {@link LINE_TRIGGER_ATTRS} that also requires rewriting `line_item_line_total`. */
const LINE_TOTAL_TRIGGER_ATTRS = new Set<SystemAttribute>(['line_item_qty', 'line_item_unit_price'])

/** Fields on `quotes` whose write should trigger a recompute (money MQ1 build spec §F.2). */
const QUOTE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'quote_discount_type',
  'quote_discount_value',
  'quote_tax_rate',
])

/**
 * Recompute a quote's `subtotal`/`taxTotal`/`total` from its current lines + billing
 * fields and write the mirrors via `FieldValueService`. The single source of truth
 * for "what are this quote's totals right now" — called by both field-change hooks
 * below and the `money.recomputeTotals` router mutation (delete path + drift escape,
 * §F.2/§G.2).
 */
export async function recomputeTotals(input: RecomputeTotalsInput): Promise<void> {
  const { organizationId, userId, quoteInstanceId } = input
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
    mode: 'oneshot',
  })

  const lines: LineForTotals[] = []
  if (cf.line_item_line_total && cf.line_item_taxable) {
    const lineTotalFieldId = cf.line_item_line_total.id
    const taxableFieldId = cf.line_item_taxable.id
    for (const lineInstanceId of lineInstanceIds) {
      const lineRecordId = toRecordId('line_item', lineInstanceId)
      const lineValues = await handler.getFieldValues(lineRecordId, [
        lineTotalFieldId,
        taxableFieldId,
      ])
      const lineTotalTyped = firstTyped(lineValues.get(lineTotalFieldId))
      const taxableTyped = firstTyped(lineValues.get(taxableFieldId))
      lines.push({
        lineTotal: lineTotalTyped ? (extractValue(lineTotalTyped) as number) : null,
        taxable: taxableTyped ? (extractValue(taxableTyped) as boolean) : true,
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
 * Recompute hook for `line-items` (money MQ1 build spec §F.2, registered under the
 * `line-items` apiSlug in `field-hooks/register-hooks.ts`). Steps:
 *
 * 1. If `qty`/`unitPrice` changed, recompute + write `line_item_line_total`
 *    (`publishEvents` ON — the builder's lineTotal cell updates via realtime).
 * 2. Resolve the line's parent quote and recompute+write its mirrored totals.
 *    Work-order lines have no stored totals in MQ1 — skipped when there's no
 *    `line_item_quote` value.
 *
 * No recursion: the fields this hook writes (`line_total`, `subtotal`/`tax_total`/
 * `total`) are not in {@link LINE_TRIGGER_ATTRS} or {@link QUOTE_TRIGGER_ATTRS}, so
 * re-entry exits immediately on the systemAttribute filter.
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
    .bySystemAttributes(['line_item_qty', 'line_item_unit_price', 'line_item_quote'] as const)

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
  if (!cf.line_item_quote) return
  const quoteValues = await handler.getFieldValues(lineRecordId, [cf.line_item_quote.id])
  const quoteTyped = firstTyped(quoteValues.get(cf.line_item_quote.id))
  if (quoteTyped?.type !== 'relationship' || !quoteTyped.recordId) return

  const { entityInstanceId: quoteInstanceId } = parseRecordId(quoteTyped.recordId)
  await recomputeTotals({ organizationId, userId, quoteInstanceId })
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
    quoteInstanceId,
  })
}
