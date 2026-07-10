// apps/worker/scripts/verify-money-mq1.ts
/**
 * Money MQ1 (Quoting Records) end-to-end verification (plans/dispatch/money/03-mq1-build.md §J).
 * Exercises the REAL write paths: UnifiedCrudHandler.create/update (QUO number pre-hook,
 * quote/request lifecycle-guard pre-hooks), the totals-engine field-change hooks
 * (registerEntityFieldChangeHooks on 'line-items'/'quotes'), the money lifecycle mutations
 * (markQuoteSent/approveQuote/declineQuote/createQuoteFromRequest), convertQuoteToWorkOrder,
 * reorderLines, recomputeTotals, the dispatch convert-through-quote delegation, and the two
 * money settings keys.
 *
 * Creates records prefixed "[MQ1-verify]" and deletes them at the end (try/finally).
 *
 * Run (from repo root) under the worker runtime:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/verify-money-mq1.ts
 */

import { database } from '@auxx/database'
import { convertRequestToWorkOrder } from '@auxx/lib/dispatch'
import {
  approveQuote,
  computeDocumentTotals,
  convertQuoteToWorkOrder,
  createQuoteFromRequest,
  declineQuote,
  markQuoteSent,
  recomputeTotals,
  reorderLines,
} from '@auxx/lib/money'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { getOrganizationSetting } from '@auxx/lib/settings'

/** Build a RecordId string without pulling in `@auxx/types` (not a worker dependency). */
function toRecordId(entityDefinitionId: string, entityInstanceId: string) {
  return `${entityDefinitionId}:${entityInstanceId}` as never
}

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}`, detail ?? '')
  }
}

async function entityDefId(organizationId: string, entityType: string) {
  const def = await database.query.EntityDefinition.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.entityType, entityType)),
  })
  return def?.id ?? null
}

async function fieldId(organizationId: string, entityType: string, systemAttribute: string) {
  const defId = await entityDefId(organizationId, entityType)
  if (!defId) return null
  const field = await database.query.CustomField.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.entityDefinitionId, defId), eq(t.systemAttribute, systemAttribute)),
  })
  return field?.id ?? null
}

async function fieldValueByAttr(
  organizationId: string,
  entityType: string,
  instanceId: string,
  systemAttribute: string
) {
  const fid = await fieldId(organizationId, entityType, systemAttribute)
  if (!fid) return null
  const fv = await database.query.FieldValue.findFirst({
    where: (t, { and, eq }) => and(eq(t.entityId, instanceId), eq(t.fieldId, fid)),
  })
  return fv ?? null
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — same as M1 script)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)

  const createdQuoteIds: string[] = [] // instance ids
  const createdLineIds: string[] = []
  const createdWorkOrderIds: string[] = []
  const createdRequestIds: string[] = []
  const createdCatalogItemIds: string[] = []

  try {
    // Find a contact to hang quotes/requests off of (contact is required on quote).
    const contactDefId = await entityDefId(organizationId, 'contact')
    const contact = contactDefId
      ? await database.query.EntityInstance.findFirst({
          columns: { id: true },
          where: (t, { eq }) => eq(t.entityDefinitionId, contactDefId),
        })
      : null
    if (!contact) throw new Error('No contact in org — cannot test quotes')
    const contactRecordId = toRecordId('contact', contact.id)

    // ── 1: QUO numbering ──────────────────────────────────────────────────
    console.log('1: QUO numbering')
    const q1 = await handler.create('quote', {
      quote_title: '[MQ1-verify] Quote one',
      quote_contact: contactRecordId,
    })
    createdQuoteIds.push(q1.instance.id)
    const q1Number = await fieldValueByAttr(organizationId, 'quote', q1.instance.id, 'quote_number')
    check(
      `quote_number auto-assigned (${q1Number?.valueText})`,
      !!q1Number?.valueText?.startsWith('QUO-')
    )

    const q2 = await handler.create('quote', {
      quote_title: '[MQ1-verify] Quote two',
      quote_contact: contactRecordId,
    })
    createdQuoteIds.push(q2.instance.id)
    const q2Number = await fieldValueByAttr(organizationId, 'quote', q2.instance.id, 'quote_number')
    check(
      `second quote increments (${q1Number?.valueText} -> ${q2Number?.valueText})`,
      !!q2Number?.valueText && q2Number.valueText !== q1Number?.valueText
    )

    // ── 2: Manual lifecycle guard on quote_status ───────────────────────────
    console.log('2: quote_status manual lifecycle guard')
    const quoteStatusFieldId = await fieldId(organizationId, 'quote', 'quote_status')
    if (!quoteStatusFieldId) throw new Error('quote_status field not found')
    const q1RecordId = toRecordId('quote', q1.instance.id)

    let sentRejectedSystemAttr = false
    try {
      await handler.update(q1RecordId, { quote_status: 'sent' })
    } catch {
      sentRejectedSystemAttr = true
    }
    check('manual quote_status=sent rejected (systemAttribute-keyed)', sentRejectedSystemAttr)

    let sentRejectedFieldId = false
    try {
      await handler.update(q1RecordId, { [quoteStatusFieldId]: 'sent' })
    } catch {
      sentRejectedFieldId = true
    }
    check('manual quote_status=sent rejected (fieldId-keyed)', sentRejectedFieldId)

    await handler.update(q1RecordId, { quote_status: 'canceled' })
    const q1StatusAfter = await fieldValueByAttr(
      organizationId,
      'quote',
      q1.instance.id,
      'quote_status'
    )
    check('manual quote_status=canceled allowed', q1StatusAfter?.optionId === 'canceled')

    // ── 3: Request mirror guard on service_request_status ──────────────────
    console.log('3: service_request_status mirror guard')
    const srStatusFieldId = await fieldId(
      organizationId,
      'service_request',
      'service_request_status'
    )
    if (!srStatusFieldId) throw new Error('service_request_status field not found')
    const request1 = await handler.create('service_request', {
      service_request_title: '[MQ1-verify] Request one',
      service_request_contact: contactRecordId,
    })
    createdRequestIds.push(request1.instance.id)
    const request1RecordId = toRecordId('service_request', request1.instance.id)

    for (const guarded of ['quoted', 'approved', 'converted']) {
      let rejected = false
      try {
        await handler.update(request1RecordId, { service_request_status: guarded })
      } catch {
        rejected = true
      }
      check(`manual service_request_status=${guarded} rejected (systemAttribute-keyed)`, rejected)

      let rejectedFieldId = false
      try {
        await handler.update(request1RecordId, { [srStatusFieldId]: guarded })
      } catch {
        rejectedFieldId = true
      }
      check(`manual service_request_status=${guarded} rejected (fieldId-keyed)`, rejectedFieldId)
    }

    await handler.update(request1RecordId, { service_request_status: 'contacted' })
    const request1StatusAfter = await fieldValueByAttr(
      organizationId,
      'service_request',
      request1.instance.id,
      'service_request_status'
    )
    check(
      'manual service_request_status=contacted allowed',
      request1StatusAfter?.optionId === 'contacted'
    )

    // ── 4: createQuoteFromRequest + one-active-quote guard ──────────────────
    console.log('4: createQuoteFromRequest')
    const request2 = await handler.create('service_request', {
      service_request_title: '[MQ1-verify] Request two',
      service_request_contact: contactRecordId,
    })
    createdRequestIds.push(request2.instance.id)

    const quoteFromReq = await createQuoteFromRequest({
      organizationId,
      userId,
      requestInstanceId: request2.instance.id,
    })
    createdQuoteIds.push(quoteFromReq.instance.id)

    const quoteFromReqTitle = await fieldValueByAttr(
      organizationId,
      'quote',
      quoteFromReq.instance.id,
      'quote_title'
    )
    check(
      'created quote copied request title',
      quoteFromReqTitle?.valueText === '[MQ1-verify] Request two'
    )
    const quoteFromReqContact = await fieldValueByAttr(
      organizationId,
      'quote',
      quoteFromReq.instance.id,
      'quote_contact'
    )
    check('created quote copied contact', quoteFromReqContact?.relatedEntityId === contact.id)
    const request2StatusAfterCreate = await fieldValueByAttr(
      organizationId,
      'service_request',
      request2.instance.id,
      'service_request_status'
    )
    check(
      'request status untouched by quote create',
      request2StatusAfterCreate?.optionId === 'new',
      request2StatusAfterCreate?.optionId
    )

    let secondCreateRejected = false
    try {
      await createQuoteFromRequest({
        organizationId,
        userId,
        requestInstanceId: request2.instance.id,
      })
    } catch {
      secondCreateRejected = true
    }
    check('one-active-quote guard rejects a second createQuoteFromRequest', secondCreateRejected)

    // Decline the first quote, then a new createQuoteFromRequest should succeed.
    await markQuoteSent({ organizationId, userId, quoteInstanceId: quoteFromReq.instance.id })
    await declineQuote({ organizationId, userId, quoteInstanceId: quoteFromReq.instance.id })
    const quoteFromReq2 = await createQuoteFromRequest({
      organizationId,
      userId,
      requestInstanceId: request2.instance.id,
    })
    createdQuoteIds.push(quoteFromReq2.instance.id)
    check(
      'createQuoteFromRequest succeeds again after declining the first',
      !!quoteFromReq2.instance.id
    )

    // ── 5: Totals engine via field-change hooks ─────────────────────────────
    console.log('5: totals engine')
    const totalsQuote = await handler.create('quote', {
      quote_title: '[MQ1-verify] Totals quote',
      quote_contact: contactRecordId,
    })
    createdQuoteIds.push(totalsQuote.instance.id)
    const totalsQuoteRecordId = toRecordId('quote', totalsQuote.instance.id)

    const lineA = await handler.create('line_item', {
      line_item_name: '[MQ1-verify] Line A (taxable)',
      line_item_qty: 2,
      line_item_unit_price: 50,
      line_item_taxable: true,
      line_item_quote: totalsQuoteRecordId,
    })
    createdLineIds.push(lineA.instance.id)
    const lineB = await handler.create('line_item', {
      line_item_name: '[MQ1-verify] Line B (non-taxable)',
      line_item_qty: 1,
      line_item_unit_price: 100,
      line_item_taxable: false,
      line_item_quote: totalsQuoteRecordId,
    })
    createdLineIds.push(lineB.instance.id)

    const lineATotal = await fieldValueByAttr(
      organizationId,
      'line_item',
      lineA.instance.id,
      'line_item_line_total'
    )
    const lineBTotal = await fieldValueByAttr(
      organizationId,
      'line_item',
      lineB.instance.id,
      'line_item_line_total'
    )
    check(
      'line A lineTotal = 100.00 (2 x $50)',
      lineATotal?.valueNumber === 100,
      lineATotal?.valueNumber
    )
    check(
      'line B lineTotal = 100.00 (1 x $100)',
      lineBTotal?.valueNumber === 100,
      lineBTotal?.valueNumber
    )

    const subtotalAfterLines = await fieldValueByAttr(
      organizationId,
      'quote',
      totalsQuote.instance.id,
      'quote_subtotal'
    )
    check(
      'quote_subtotal = 200 after two lines',
      subtotalAfterLines?.valueNumber === 200,
      subtotalAfterLines?.valueNumber
    )

    await handler.update(totalsQuoteRecordId, {
      quote_discount_type: 'percent',
      quote_discount_value: 10,
      quote_tax_rate: 7.5,
    })

    const expected = computeDocumentTotals(
      [
        { lineTotal: 100, taxable: true },
        { lineTotal: 100, taxable: false },
      ],
      { discountType: 'percent', discountValue: 10, taxRate: 7.5 }
    )
    check(
      'computeDocumentTotals sanity: subtotal 200, discount 20, tax 6.75, total 186.75',
      expected.subtotal === 200 &&
        expected.discountAmount === 20 &&
        expected.taxTotal === 6.75 &&
        expected.total === 186.75,
      expected
    )

    const quoteSubtotal = await fieldValueByAttr(
      organizationId,
      'quote',
      totalsQuote.instance.id,
      'quote_subtotal'
    )
    const quoteTaxTotal = await fieldValueByAttr(
      organizationId,
      'quote',
      totalsQuote.instance.id,
      'quote_tax_total'
    )
    const quoteTotal = await fieldValueByAttr(
      organizationId,
      'quote',
      totalsQuote.instance.id,
      'quote_total'
    )
    check(
      'quote_subtotal = 200 after billing change',
      quoteSubtotal?.valueNumber === 200,
      quoteSubtotal?.valueNumber
    )
    check(
      'quote_tax_total = 6.75 after billing change',
      quoteTaxTotal?.valueNumber === 6.75,
      quoteTaxTotal?.valueNumber
    )
    check(
      'quote_total = 186.75 after billing change',
      quoteTotal?.valueNumber === 186.75,
      quoteTotal?.valueNumber
    )

    // ── 6: reorderLines ──────────────────────────────────────────────────────
    console.log('6: reorderLines')
    await reorderLines({
      organizationId,
      userId,
      orderedLineInstanceIds: [lineB.instance.id, lineA.instance.id],
    })
    const lineASortOrder = await fieldValueByAttr(
      organizationId,
      'line_item',
      lineA.instance.id,
      'line_item_sort_order'
    )
    const lineBSortOrder = await fieldValueByAttr(
      organizationId,
      'line_item',
      lineB.instance.id,
      'line_item_sort_order'
    )
    check(
      'reversed order: line B sortOrder 0, line A sortOrder 1',
      lineBSortOrder?.valueNumber === 0 && lineASortOrder?.valueNumber === 1,
      { lineBSortOrder: lineBSortOrder?.valueNumber, lineASortOrder: lineASortOrder?.valueNumber }
    )

    // ── 7: delete a line + recompute ────────────────────────────────────────
    console.log('7: delete line + recomputeTotals')
    await handler.delete(toRecordId('line_item', lineB.instance.id))
    createdLineIds.splice(createdLineIds.indexOf(lineB.instance.id), 1)
    await recomputeTotals({ organizationId, userId, quoteInstanceId: totalsQuote.instance.id })

    const subtotalAfterDelete = await fieldValueByAttr(
      organizationId,
      'quote',
      totalsQuote.instance.id,
      'quote_subtotal'
    )
    const totalAfterDelete = await fieldValueByAttr(
      organizationId,
      'quote',
      totalsQuote.instance.id,
      'quote_total'
    )
    // Only line A (taxable, 100) remains: subtotal 100, discount 10% = 10,
    // taxBase = 100 * (1 - 10/100) = 90, tax = 90 * 0.075 = 6.75, total = 100 - 10 + 6.75 = 96.75
    check(
      'quote_subtotal drops to 100 after delete',
      subtotalAfterDelete?.valueNumber === 100,
      subtotalAfterDelete?.valueNumber
    )
    check(
      'quote_total drops to 96.75 after delete',
      totalAfterDelete?.valueNumber === 96.75,
      totalAfterDelete?.valueNumber
    )

    // ── 8: Lifecycle mirrors (markQuoteSent / approveQuote / declineQuote) ──
    console.log('8: lifecycle mirrors')
    const request3 = await handler.create('service_request', {
      service_request_title: '[MQ1-verify] Request three',
      service_request_contact: contactRecordId,
    })
    createdRequestIds.push(request3.instance.id)
    const quoteForLifecycle = await createQuoteFromRequest({
      organizationId,
      userId,
      requestInstanceId: request3.instance.id,
    })
    createdQuoteIds.push(quoteForLifecycle.instance.id)

    await markQuoteSent({ organizationId, userId, quoteInstanceId: quoteForLifecycle.instance.id })
    const quoteSentStatus = await fieldValueByAttr(
      organizationId,
      'quote',
      quoteForLifecycle.instance.id,
      'quote_status'
    )
    const request3StatusAfterSent = await fieldValueByAttr(
      organizationId,
      'service_request',
      request3.instance.id,
      'service_request_status'
    )
    check('markQuoteSent -> quote sent', quoteSentStatus?.optionId === 'sent')
    check('markQuoteSent -> request quoted', request3StatusAfterSent?.optionId === 'quoted')

    await approveQuote({ organizationId, userId, quoteInstanceId: quoteForLifecycle.instance.id })
    const quoteApprovedStatus = await fieldValueByAttr(
      organizationId,
      'quote',
      quoteForLifecycle.instance.id,
      'quote_status'
    )
    const request3StatusAfterApprove = await fieldValueByAttr(
      organizationId,
      'service_request',
      request3.instance.id,
      'service_request_status'
    )
    check('approveQuote -> quote approved', quoteApprovedStatus?.optionId === 'approved')
    check('approveQuote -> request approved', request3StatusAfterApprove?.optionId === 'approved')

    // Separate quote for decline (request status must stay untouched).
    const request4 = await handler.create('service_request', {
      service_request_title: '[MQ1-verify] Request four',
      service_request_contact: contactRecordId,
    })
    createdRequestIds.push(request4.instance.id)
    const quoteForDecline = await createQuoteFromRequest({
      organizationId,
      userId,
      requestInstanceId: request4.instance.id,
    })
    createdQuoteIds.push(quoteForDecline.instance.id)
    await markQuoteSent({ organizationId, userId, quoteInstanceId: quoteForDecline.instance.id })
    const request4StatusBeforeDecline = await fieldValueByAttr(
      organizationId,
      'service_request',
      request4.instance.id,
      'service_request_status'
    )
    await declineQuote({ organizationId, userId, quoteInstanceId: quoteForDecline.instance.id })
    const quoteDeclinedStatus = await fieldValueByAttr(
      organizationId,
      'quote',
      quoteForDecline.instance.id,
      'quote_status'
    )
    const request4StatusAfterDecline = await fieldValueByAttr(
      organizationId,
      'service_request',
      request4.instance.id,
      'service_request_status'
    )
    check('declineQuote -> quote declined', quoteDeclinedStatus?.optionId === 'declined')
    check(
      'declineQuote -> request status unchanged',
      request4StatusAfterDecline?.optionId === request4StatusBeforeDecline?.optionId,
      { before: request4StatusBeforeDecline?.optionId, after: request4StatusAfterDecline?.optionId }
    )

    // ── 9: convertQuoteToWorkOrder on the approved quote ────────────────────
    console.log('9: convertQuoteToWorkOrder')
    // A catalog item to prove the catalogItem rel is preserved on the WO copy.
    const catalogItem = await handler.create('catalog_item', {
      catalog_item_name: '[MQ1-verify] Catalog item',
      catalog_item_default_unit_price: 20,
    })
    const createdCatalogItemId = catalogItem.instance.id
    createdCatalogItemIds.push(createdCatalogItemId)

    // Give the approved quote (from §8) a couple of lines to duplicate.
    const convertLine1 = await handler.create('line_item', {
      line_item_name: '[MQ1-verify] Convert line 1',
      line_item_qty: 3,
      line_item_unit_price: 20,
      line_item_taxable: true,
      line_item_quote: toRecordId('quote', quoteForLifecycle.instance.id),
      line_item_catalog_item: toRecordId('catalog_item', createdCatalogItemId),
    })
    createdLineIds.push(convertLine1.instance.id)
    const convertLine2 = await handler.create('line_item', {
      line_item_name: '[MQ1-verify] Convert line 2',
      line_item_qty: 1,
      line_item_unit_price: 40,
      line_item_taxable: false,
      line_item_quote: toRecordId('quote', quoteForLifecycle.instance.id),
    })
    createdLineIds.push(convertLine2.instance.id)

    const convertedWo = await convertQuoteToWorkOrder({
      organizationId,
      userId,
      quoteInstanceId: quoteForLifecycle.instance.id,
    })
    createdWorkOrderIds.push(convertedWo.instance.id)

    const woQuoteLink = await fieldValueByAttr(
      organizationId,
      'work_order',
      convertedWo.instance.id,
      'work_order_quote'
    )
    check(
      'work_order_quote set on converted WO',
      woQuoteLink?.relatedEntityId === quoteForLifecycle.instance.id
    )

    const woPricingModel = await fieldValueByAttr(
      organizationId,
      'work_order',
      convertedWo.instance.id,
      'work_order_pricing_model'
    )
    const woInvoiceTiming = await fieldValueByAttr(
      organizationId,
      'work_order',
      convertedWo.instance.id,
      'work_order_invoice_timing'
    )
    check(
      'work_order pricing_model copied (per_visit)',
      woPricingModel?.optionId === 'per_visit',
      woPricingModel?.optionId
    )
    check(
      'work_order invoice_timing copied (on_completion)',
      woInvoiceTiming?.optionId === 'on_completion',
      woInvoiceTiming?.optionId
    )

    const request3StatusAfterConvert = await fieldValueByAttr(
      organizationId,
      'service_request',
      request3.instance.id,
      'service_request_status'
    )
    check(
      'request -> converted after convertQuoteToWorkOrder',
      request3StatusAfterConvert?.optionId === 'converted'
    )

    const woLines = await handler.listFiltered({
      entityDefinitionId: 'line_item',
      filters: [
        {
          id: 'wo-lines',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'wo-lines-c1',
              fieldId: 'line_item:workOrder',
              operator: 'is',
              value: toRecordId('work_order', convertedWo.instance.id),
            },
          ],
        },
      ],
      limit: 100,
      mode: 'oneshot',
    })
    for (const id of woLines.ids) createdLineIds.push(id)
    check('WO got 2 duplicated lines', woLines.ids.length === 2, woLines.ids.length)

    let copiesHaveNoQuoteRel = true
    let catalogRelPreservedOnCopy = false
    for (const lineInstanceId of woLines.ids) {
      const quoteRel = await fieldValueByAttr(
        organizationId,
        'line_item',
        lineInstanceId,
        'line_item_quote'
      )
      if (quoteRel?.relatedEntityId) copiesHaveNoQuoteRel = false

      const catalogRel = await fieldValueByAttr(
        organizationId,
        'line_item',
        lineInstanceId,
        'line_item_catalog_item'
      )
      if (catalogRel?.relatedEntityId === createdCatalogItemId) catalogRelPreservedOnCopy = true
    }
    check('copies have NO line_item_quote', copiesHaveNoQuoteRel)
    check('catalogItem rel preserved on the copy that had one', catalogRelPreservedOnCopy)

    const originalQuoteLines = await handler.listFiltered({
      entityDefinitionId: 'line_item',
      filters: [
        {
          id: 'quote-lines-untouched',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'quote-lines-untouched-c1',
              fieldId: 'line_item:quote',
              operator: 'is',
              value: toRecordId('quote', quoteForLifecycle.instance.id),
            },
          ],
        },
      ],
      limit: 100,
      mode: 'oneshot',
    })
    check(
      'original quote lines untouched (still 2, still linked to quote)',
      originalQuoteLines.ids.length === 2,
      originalQuoteLines.ids.length
    )

    // ── 10: Dispatch convert-through-quote + old M1 path fallback ───────────
    console.log('10: dispatch convert-through-quote')
    const request5 = await handler.create('service_request', {
      service_request_title: '[MQ1-verify] Request five (convert-through-quote)',
      service_request_contact: contactRecordId,
    })
    createdRequestIds.push(request5.instance.id)
    const quote5 = await createQuoteFromRequest({
      organizationId,
      userId,
      requestInstanceId: request5.instance.id,
    })
    createdQuoteIds.push(quote5.instance.id)
    await markQuoteSent({ organizationId, userId, quoteInstanceId: quote5.instance.id })
    await approveQuote({ organizationId, userId, quoteInstanceId: quote5.instance.id })

    const convertedThroughQuote = await convertRequestToWorkOrder({
      organizationId,
      userId,
      requestInstanceId: request5.instance.id,
    })
    createdWorkOrderIds.push(convertedThroughQuote.instance.id)
    const cwoQuoteLink = await fieldValueByAttr(
      organizationId,
      'work_order',
      convertedThroughQuote.instance.id,
      'work_order_quote'
    )
    check(
      'dispatch convert delegates through quote (work_order_quote set)',
      cwoQuoteLink?.relatedEntityId === quote5.instance.id
    )

    // Request with NO approved quote still converts via the old M1 (line-less) path.
    const request6 = await handler.create('service_request', {
      service_request_title: '[MQ1-verify] Request six (no quote)',
      service_request_contact: contactRecordId,
    })
    createdRequestIds.push(request6.instance.id)
    const oldPathWo = await convertRequestToWorkOrder({
      organizationId,
      userId,
      requestInstanceId: request6.instance.id,
    })
    createdWorkOrderIds.push(oldPathWo.instance.id)
    const oldPathQuoteLink = await fieldValueByAttr(
      organizationId,
      'work_order',
      oldPathWo.instance.id,
      'work_order_quote'
    )
    check(
      'request with no approved quote converts via old M1 path (no quote link)',
      !oldPathQuoteLink?.relatedEntityId
    )

    // ── 11: Settings keys ────────────────────────────────────────────────────
    console.log('11: settings keys')
    const currency = await getOrganizationSetting({
      organizationId,
      key: 'organization.currency',
    })
    check("organization.currency defaults to 'USD'", currency === 'USD', currency)

    const taxRates = await getOrganizationSetting({
      organizationId,
      key: 'documents.taxRates',
    })
    check(
      'documents.taxRates defaults to []',
      Array.isArray(taxRates) && taxRates.length === 0,
      taxRates
    )
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────
    console.log(
      `Cleanup: deleting ${createdLineIds.length} lines, ${createdWorkOrderIds.length} work orders, ` +
        `${createdQuoteIds.length} quotes, ${createdRequestIds.length} requests, ` +
        `${createdCatalogItemIds.length} catalog items`
    )
    for (const id of [...new Set(createdLineIds)]) {
      try {
        await handler.delete(toRecordId('line_item', id))
      } catch (err) {
        console.log(
          `  cleanup failed for line_item:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of createdWorkOrderIds) {
      try {
        await handler.delete(toRecordId('work_order', id))
      } catch (err) {
        console.log(
          `  cleanup failed for work_order:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of createdQuoteIds) {
      try {
        await handler.delete(toRecordId('quote', id))
      } catch (err) {
        console.log(`  cleanup failed for quote:${id}:`, err instanceof Error ? err.message : err)
      }
    }
    for (const id of createdRequestIds) {
      try {
        await handler.delete(toRecordId('service_request', id))
      } catch (err) {
        console.log(
          `  cleanup failed for service_request:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of createdCatalogItemIds) {
      try {
        await handler.delete(toRecordId('catalog_item', id))
      } catch (err) {
        console.log(
          `  cleanup failed for catalog_item:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
