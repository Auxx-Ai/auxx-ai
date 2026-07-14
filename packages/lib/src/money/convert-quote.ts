// packages/lib/src/money/convert-quote.ts

import { database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, isNull } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import { FieldValueService } from '../field-values/field-value-service'
import { UnifiedCrudHandler } from '../resources/crud'
import type { ConvertQuoteToWorkOrderInput } from './types'

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Convert an approved quote into a work order (money MQ1 build spec §F.4). Copies
 * title/contact/pricingModel/invoiceTiming onto the new work order, links
 * `work_order_quote` back to the source quote, DUPLICATES the quote's lines onto the
 * work order (the quote's own lines are left untouched — copy, not move), and flips
 * the linked service request (if any) to `converted`.
 *
 * @returns The created work order (`CreateEntityResult` shape from `UnifiedCrudHandler.create`)
 */
export async function convertQuoteToWorkOrder(input: ConvertQuoteToWorkOrderInput) {
  const { organizationId, userId, quoteInstanceId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()
  const quoteRecordId = toRecordId('quote', quoteInstanceId)

  // ─── Step 1: assert approved ────────────────────────────────────────────────
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'quote_status',
      'quote_title',
      'quote_contact',
      'quote_request',
      'quote_pricing_model',
      'quote_invoice_timing',
      'service_request_address',
    ] as const)

  const quoteFieldIds = [
    cf.quote_status,
    cf.quote_title,
    cf.quote_contact,
    cf.quote_request,
    cf.quote_pricing_model,
    cf.quote_invoice_timing,
  ]
    .filter(Boolean)
    .map((f) => f!.id)
  const quoteValues = await handler.getFieldValues(quoteRecordId, quoteFieldIds)

  const statusTyped = cf.quote_status ? firstTyped(quoteValues.get(cf.quote_status.id)) : undefined
  const status = statusTyped ? (extractValue(statusTyped) as string) : undefined
  if (status !== 'approved') {
    throw new BadRequestError(
      `Cannot convert to work order — quote must be 'approved' (currently '${status ?? 'unknown'}')`
    )
  }

  // One-job-per-quote guard: the quote stays `approved` after conversion (there is
  // no `converted` quote status), so without this a second convert — e.g. the admin
  // clicking "Convert to job" after the public accept page already auto-converted —
  // would silently duplicate the job. Canceled jobs don't count: a canceled
  // conversion can be redone.
  const existingJobs = await handler.listFiltered({
    entityDefinitionId: 'work_order',
    filters: [
      {
        id: 'converted-job-guard',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'converted-job-guard-quote',
            fieldId: 'work_order:quote',
            operator: 'is',
            value: quoteRecordId,
          },
          {
            id: 'converted-job-guard-status',
            fieldId: 'work_order:status',
            operator: 'not in',
            value: ['canceled'],
          },
        ],
      },
    ],
    limit: 1,
    mode: 'oneshot',
  })
  if (existingJobs.ids.length > 0) {
    throw new BadRequestError('This quote has already been converted to a job')
  }

  // ─── Step 2: read quote fields + the request's serviceAddress when linked ──
  const titleTyped = cf.quote_title ? firstTyped(quoteValues.get(cf.quote_title.id)) : undefined
  const contactTyped = cf.quote_contact
    ? firstTyped(quoteValues.get(cf.quote_contact.id))
    : undefined
  const requestTyped = cf.quote_request
    ? firstTyped(quoteValues.get(cf.quote_request.id))
    : undefined
  const pricingModelTyped = cf.quote_pricing_model
    ? firstTyped(quoteValues.get(cf.quote_pricing_model.id))
    : undefined
  const invoiceTimingTyped = cf.quote_invoice_timing
    ? firstTyped(quoteValues.get(cf.quote_invoice_timing.id))
    : undefined

  const title = titleTyped ? (extractValue(titleTyped) as string) : undefined
  const contactRecordId = contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined
  const requestRecordId = requestTyped?.type === 'relationship' ? requestTyped.recordId : undefined
  const pricingModel = pricingModelTyped ? extractValue(pricingModelTyped) : undefined
  const invoiceTiming = invoiceTimingTyped ? extractValue(invoiceTimingTyped) : undefined

  let serviceAddress: unknown
  if (requestRecordId && cf.service_request_address) {
    const requestValues = await handler.getFieldValues(requestRecordId, [
      cf.service_request_address.id,
    ])
    const addressTyped = firstTyped(requestValues.get(cf.service_request_address.id))
    serviceAddress = addressTyped?.type === 'json' ? addressTyped.value : undefined
  }

  // ─── Step 3: create the work order ──────────────────────────────────────────
  const workOrderValues: Record<string, unknown> = {
    work_order_title: title || `Work order from quote ${quoteInstanceId}`,
    work_order_status: 'new',
    work_order_quote: quoteRecordId,
  }
  if (contactRecordId) workOrderValues.work_order_contact = contactRecordId
  if (requestRecordId) workOrderValues.work_order_request = requestRecordId
  if (serviceAddress) workOrderValues.work_order_address = serviceAddress
  if (pricingModel) workOrderValues.work_order_pricing_model = pricingModel
  if (invoiceTiming) workOrderValues.work_order_invoice_timing = invoiceTiming

  // Events ON (user-triggered): visit auto-create + the WO number hook fire like any
  // create (dispatch §H.1/§F.4a precedent).
  const createdWorkOrder = await handler.create('work_order', workOrderValues)
  const workOrderRecordId = createdWorkOrder.recordId

  // MP2 (§B.6): stamp any pre-paid deposit for this quote onto the newly created work order —
  // covers a deposit paid before `documents.quote.autoConvertOnAccept` ran (or the setting is
  // off), where the checkout-time write (`createStripeDepositCheckout`) couldn't resolve a work
  // order yet. `isNull(workOrderInstanceId)` makes this idempotent against a second manual
  // convert attempt. A direct write, not routed through `ledger.ts` — the plan sanctions this as
  // the one exception to that file being the sole PaymentTransaction writer, since it's stamping
  // linkage, not settling money.
  await database
    .update(schema.PaymentTransaction)
    .set({ workOrderInstanceId: createdWorkOrder.instance.id })
    .where(
      and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        eq(schema.PaymentTransaction.quoteInstanceId, quoteInstanceId),
        eq(schema.PaymentTransaction.kind, 'charge'),
        eq(schema.PaymentTransaction.status, 'succeeded'),
        isNull(schema.PaymentTransaction.workOrderInstanceId)
      )
    )

  // ─── Step 4: copy lines, ordered by sortOrder ───────────────────────────────
  // No `line_item_quote` on the copies — the quote keeps its own lines untouched;
  // the job gets its own set.
  const lineCf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
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
    ] as const)

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
    sorting: [{ id: 'sortOrder', desc: false }],
    limit: 1000,
    mode: 'oneshot',
  })

  const lineFieldIds = [
    lineCf.line_item_name,
    lineCf.line_item_description,
    lineCf.line_item_qty,
    lineCf.line_item_unit_price,
    lineCf.line_item_line_total,
    lineCf.line_item_taxable,
    lineCf.line_item_category,
    lineCf.line_item_discount,
    lineCf.line_item_sort_order,
    lineCf.line_item_catalog_item,
  ]
    .filter(Boolean)
    .map((f) => f!.id)

  for (const lineInstanceId of lineInstanceIds) {
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
      line_item_work_order: workOrderRecordId,
    }
    if (catalogItemTyped?.type === 'relationship') {
      copyValues.line_item_catalog_item = catalogItemTyped.recordId
    }

    await handler.create('line_item', copyValues)
  }

  // ─── Step 5: request → converted (work_order_request already set in step 3) ─
  if (requestRecordId) {
    const fieldValueService = new FieldValueService(organizationId, userId)
    await fieldValueService.setValuesForEntity({
      recordId: requestRecordId,
      values: [{ fieldId: 'service_request_status', value: 'converted' }],
    })
  }

  // ─── Step 6: return the created work order ──────────────────────────────────
  return createdWorkOrder
}
