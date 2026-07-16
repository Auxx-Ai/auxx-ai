// apps/worker/scripts/verify-money-line-pricing.ts
/**
 * Money 13 + 17 + 18 (unit-based pricing / part-markup catalog pricing / optional line items)
 * integration verification (plans/dispatch/money/13-unit-based-pricing.md §8,
 * 17-part-markup-pricing.md §7, 18-optional-line-items.md §9 — Automated sections only, browser
 * passes are out of scope for this script). Exercises the real write paths — `markQuoteSent`/
 * `approveQuote`/`convertQuoteToWorkOrder` (money/quote-lifecycle.ts, money/convert-quote.ts),
 * `createInvoiceFromWorkOrder` (money/gather.ts, the "gather" mutation), `acceptQuoteByToken`
 * (money/quote-acceptance.ts, the public-token accept path a real POST would hit), and the BOM
 * cost-recalc → catalog-pricing sync chain (field-hooks/post/bom-cost-triggers.ts →
 * bom/cost-calculator.ts → money/catalog-pricing.ts), all driven end to end against the live dev
 * DB instead of the mocked 273 vitest tests.
 *
 * SAFETY: the dev `.env` is LIVE email + a LIVE worker draining queues. `acceptQuoteByToken`/
 * `declineQuoteByToken`/`requestQuoteUpdateByToken`'s only side-notification path is
 * `notifyQuoteCreator` (quote-acceptance.ts) → `NotificationService.sendNotification`
 * (notifications/notification-service.ts) — that call is DB-insert + realtime-publish ONLY (an
 * explicit `// Future enhancement: Add email/push notification delivery here` comment in that
 * file confirms no email/queue path exists today). So calling `acceptQuoteByToken` directly here
 * is safe: there is nothing to neutralize, unlike the Stripe-charge/refund calls the sibling
 * money scripts (`verify-money-deposit-allocations.ts`) avoid. This script never calls anything
 * Stripe-shaped (no checkout/charge creation) and never touches the email-sending
 * `prepareDocumentEmail`/`sendPaymentReceipt` paths either.
 *
 * Org settings this script depends on (`documents.quote.acceptancePageEnabled`,
 * `documents.quote.autoConvertOnAccept`) are read first; a direct DB check confirmed dev org
 * `u45w22ft66ymiaa19ohs7m9f` (Marki Corp) has zero `OrganizationSetting` override rows for either
 * key, so both are at their shipped defaults (`true`/`true`) — no override is needed. The script
 * still defends against dev-DB drift: if either is ever found `false`, it flips it on and restores
 * the exact original value (byte-exact) in `finally`.
 *
 * Creates records prefixed "[LP-verify]" and deletes/reverts everything in a try/finally.
 * Cleanup order (mirrors `verify-money-deposit-allocations.ts`'s precedent): invoices FIRST
 * (cascades `InvoiceLineAllocation` rows away, freeing the restrict FK on the gathered source
 * line) BEFORE line items BEFORE work orders BEFORE quotes BEFORE catalog items BEFORE vendor
 * parts BEFORE parts BEFORE the vendor company BEFORE the shared contact.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -- node --conditions source --import tsx/esm \
 *     scripts/verify-money-line-pricing.ts
 */

import { database } from '@auxx/database'
import { getOrgCache } from '@auxx/lib/cache'
import { AuxxError } from '@auxx/lib/errors'
import {
  acceptQuoteByToken,
  approveQuote,
  convertQuoteToWorkOrder,
  createInvoiceFromWorkOrder,
  ensureQuotePublicToken,
  markQuoteSent,
} from '@auxx/lib/money'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { ALL_ENTITY_MIGRATIONS } from '@auxx/lib/seed/entity-migrations'
import { getOrganizationSetting, updateOrganizationSetting } from '@auxx/lib/settings'

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

/** Run `fn`, expecting it to throw. Returns the caught error (or `undefined` if it didn't). */
async function expectThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
    return undefined
  } catch (err) {
    return err ?? new Error('threw a falsy value')
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

/** Read one `FieldValue` row by (entityType, instanceId, systemAttribute). `null` when unset. */
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

/** `line_item` instance ids matching one relationship filter (`line_item:quote is X`, etc). */
async function lineIdsWhere(handler: UnifiedCrudHandler, filterFieldId: string, value: unknown) {
  const { ids } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'f',
        logicalOperator: 'AND',
        conditions: [{ id: 'c', fieldId: filterFieldId, operator: 'is', value }],
      },
    ],
    limit: 200,
    mode: 'oneshot',
  })
  return ids
}

/** `work_order` instance ids linked to a given quote (mirrors convert-quote.ts's own guard query). */
async function workOrderIdsForQuote(handler: UnifiedCrudHandler, quoteRecordId: unknown) {
  const { ids } = await handler.listFiltered({
    entityDefinitionId: 'work_order',
    filters: [
      {
        id: 'f',
        logicalOperator: 'AND',
        conditions: [
          { id: 'c', fieldId: 'work_order:quote', operator: 'is', value: quoteRecordId },
        ],
      },
    ],
    limit: 10,
    mode: 'oneshot',
  })
  return ids
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)

  const createdContactIds: string[] = []
  const createdCompanyIds: string[] = []
  const createdPartIds: string[] = []
  const createdVendorPartIds: string[] = []
  const createdCatalogItemIds: string[] = []
  const createdQuoteIds: string[] = []
  const createdLineIds: string[] = []
  const createdWorkOrderIds: string[] = []
  const createdInvoiceIds: string[] = []

  // ── Defensive org-settings guard (byte-exact restore) ────────────────────────
  let acceptancePageOverridden = false
  let originalAcceptancePageEnabled: unknown = null
  let autoConvertOverridden = false
  let originalAutoConvertOnAccept: unknown = null

  try {
    originalAcceptancePageEnabled = await getOrganizationSetting({
      organizationId,
      key: 'documents.quote.acceptancePageEnabled',
    })
    if (originalAcceptancePageEnabled === false) {
      await updateOrganizationSetting({
        organizationId,
        key: 'documents.quote.acceptancePageEnabled',
        value: true,
      })
      await getOrgCache().invalidateAndRecompute(organizationId, ['orgSettings'])
      acceptancePageOverridden = true
    }
    originalAutoConvertOnAccept = await getOrganizationSetting({
      organizationId,
      key: 'documents.quote.autoConvertOnAccept',
    })
    if (originalAutoConvertOnAccept === false) {
      await updateOrganizationSetting({
        organizationId,
        key: 'documents.quote.autoConvertOnAccept',
        value: true,
      })
      await getOrgCache().invalidateAndRecompute(organizationId, ['orgSettings'])
      autoConvertOverridden = true
    }

    const contact = await handler.create('contact', {
      first_name: '[LP-verify]',
      last_name: 'Test Customer',
      primary_email: 'lp-verify@example.com',
    })
    createdContactIds.push(contact.instance.id)
    const contactRecordId = toRecordId('contact', contact.instance.id)

    // ══════════════════════════════════════════════════════════════════════
    // A. Units snapshot chain (13 §8)
    // ══════════════════════════════════════════════════════════════════════
    console.log('A: units snapshot chain')

    const catA = await handler.create('catalog_item', {
      catalog_item_name: '[LP-verify] Hourly Labor',
      catalog_item_default_unit: 'hour',
      catalog_item_default_unit_price: 5000,
    })
    createdCatalogItemIds.push(catA.instance.id)

    const quoteUnits = await handler.create('quote', {
      quote_title: '[LP-verify] Units chain quote',
      quote_contact: contactRecordId,
    })
    createdQuoteIds.push(quoteUnits.instance.id)

    // A.1 — simulate the server-side catalog pick: create the line with the catalog item's unit.
    const lineUnits = await handler.create('line_item', {
      line_item_name: '[LP-verify] Hourly Labor line',
      line_item_qty: 1,
      line_item_unit_price: 5000,
      line_item_taxable: false,
      line_item_unit: 'hour',
      line_item_catalog_item: toRecordId('catalog_item', catA.instance.id),
      line_item_quote: quoteUnits.recordId,
    })
    createdLineIds.push(lineUnits.instance.id)

    const lineUnitsInitial = await fieldValueByAttr(
      organizationId,
      'line_item',
      lineUnits.instance.id,
      'line_item_unit'
    )
    check('A1: picked line has unit "hour"', lineUnitsInitial?.optionId === 'hour')

    // A.2 — edit the line's unit; catalog item's own default is untouched (snapshot independence).
    await handler.update(toRecordId('line_item', lineUnits.instance.id), { line_item_unit: 'day' })
    const lineUnitsAfterEdit = await fieldValueByAttr(
      organizationId,
      'line_item',
      lineUnits.instance.id,
      'line_item_unit'
    )
    check('A2: line unit edited to "day"', lineUnitsAfterEdit?.optionId === 'day')
    const catAUnitAfterEdit = await fieldValueByAttr(
      organizationId,
      'catalog_item',
      catA.instance.id,
      'catalog_item_default_unit'
    )
    check(
      'A2: catalog item defaultUnit still "hour" (snapshot independence)',
      catAUnitAfterEdit?.optionId === 'hour'
    )

    // A.3 — convert to work order: copied line carries the CURRENT unit ("day").
    await markQuoteSent({ organizationId, userId, quoteInstanceId: quoteUnits.instance.id })
    await approveQuote({ organizationId, userId, quoteInstanceId: quoteUnits.instance.id })
    const woUnits = await convertQuoteToWorkOrder({
      organizationId,
      userId,
      quoteInstanceId: quoteUnits.instance.id,
    })
    createdWorkOrderIds.push(woUnits.instance.id)

    const woUnitsLineIds = await lineIdsWhere(handler, 'line_item:workOrder', woUnits.recordId)
    createdLineIds.push(...woUnitsLineIds)
    check(
      'A3: exactly one copied line on the work order',
      woUnitsLineIds.length === 1,
      woUnitsLineIds
    )
    const woLineId = woUnitsLineIds[0]!
    const woLineUnit = await fieldValueByAttr(
      organizationId,
      'line_item',
      woLineId,
      'line_item_unit'
    )
    check('A3: converted job line has unit "day"', woLineUnit?.optionId === 'day')

    // A.4 — gather the work-order line onto an invoice: invoice copy carries "day" too.
    const invoiceUnits = await createInvoiceFromWorkOrder({
      organizationId,
      userId,
      workOrderInstanceId: woUnits.instance.id,
      lineInstanceIds: [woLineId],
    })
    createdInvoiceIds.push(invoiceUnits.instanceId)

    const invoiceUnitsLineIds = await lineIdsWhere(
      handler,
      'line_item:invoice',
      invoiceUnits.recordId
    )
    createdLineIds.push(...invoiceUnitsLineIds)
    check(
      'A4: exactly one gathered line on the invoice',
      invoiceUnitsLineIds.length === 1,
      invoiceUnitsLineIds
    )
    const invoiceLineId = invoiceUnitsLineIds[0]!
    const invoiceLineUnit = await fieldValueByAttr(
      organizationId,
      'line_item',
      invoiceLineId,
      'line_item_unit'
    )
    check('A4: gathered invoice line has unit "day"', invoiceLineUnit?.optionId === 'day')

    // A.5 — editing the invoice copy's unit does not mutate the work-order source line.
    await handler.update(toRecordId('line_item', invoiceLineId), { line_item_unit: 'hour' })
    const woLineUnitAfterInvoiceEdit = await fieldValueByAttr(
      organizationId,
      'line_item',
      woLineId,
      'line_item_unit'
    )
    check(
      'A5: editing invoice copy unit leaves work-order line unchanged ("day")',
      woLineUnitAfterInvoiceEdit?.optionId === 'day'
    )

    // A.6 — a line with a null unit stays null through the same chain (legacy shape).
    const quoteNull = await handler.create('quote', {
      quote_title: '[LP-verify] Null-unit chain quote',
      quote_contact: contactRecordId,
    })
    createdQuoteIds.push(quoteNull.instance.id)
    const lineNull = await handler.create('line_item', {
      line_item_name: '[LP-verify] Legacy no-unit line',
      line_item_qty: 1,
      line_item_unit_price: 1000,
      line_item_taxable: false,
      line_item_quote: quoteNull.recordId,
    })
    createdLineIds.push(lineNull.instance.id)
    const lineNullUnit = await fieldValueByAttr(
      organizationId,
      'line_item',
      lineNull.instance.id,
      'line_item_unit'
    )
    check('A6: legacy line has no unit set', lineNullUnit === null, lineNullUnit)

    await markQuoteSent({ organizationId, userId, quoteInstanceId: quoteNull.instance.id })
    await approveQuote({ organizationId, userId, quoteInstanceId: quoteNull.instance.id })
    const woNull = await convertQuoteToWorkOrder({
      organizationId,
      userId,
      quoteInstanceId: quoteNull.instance.id,
    })
    createdWorkOrderIds.push(woNull.instance.id)
    const woNullLineIds = await lineIdsWhere(handler, 'line_item:workOrder', woNull.recordId)
    createdLineIds.push(...woNullLineIds)
    const woNullLineUnit = await fieldValueByAttr(
      organizationId,
      'line_item',
      woNullLineIds[0]!,
      'line_item_unit'
    )
    check('A6: converted job line still has no unit', woNullLineUnit === null, woNullLineUnit)

    const invoiceNull = await createInvoiceFromWorkOrder({
      organizationId,
      userId,
      workOrderInstanceId: woNull.instance.id,
      lineInstanceIds: [woNullLineIds[0]!],
    })
    createdInvoiceIds.push(invoiceNull.instanceId)
    const invoiceNullLineIds = await lineIdsWhere(
      handler,
      'line_item:invoice',
      invoiceNull.recordId
    )
    createdLineIds.push(...invoiceNullLineIds)
    const invoiceNullLineUnit = await fieldValueByAttr(
      organizationId,
      'line_item',
      invoiceNullLineIds[0]!,
      'line_item_unit'
    )
    check(
      'A6: gathered invoice line still has no unit',
      invoiceNullLineUnit === null,
      invoiceNullLineUnit
    )

    // ══════════════════════════════════════════════════════════════════════
    // B. Optional-lines acceptance (18 §9)
    // ══════════════════════════════════════════════════════════════════════
    console.log('B: optional-lines acceptance')

    const REQUIRED_AMOUNT = 10000
    const OPTION_A_AMOUNT = 5000
    const OPTION_B_AMOUNT = 3000

    async function seedOptionalQuote(
      title: string,
      opts: { includeOptions: boolean; aSelected?: boolean; bSelected?: boolean }
    ) {
      const quote = await handler.create('quote', {
        quote_title: title,
        quote_contact: contactRecordId,
      })
      createdQuoteIds.push(quote.instance.id)

      const required = await handler.create('line_item', {
        line_item_name: '[LP-verify] Required line',
        line_item_qty: 1,
        line_item_unit_price: REQUIRED_AMOUNT,
        line_item_taxable: false,
        line_item_quote: quote.recordId,
      })
      createdLineIds.push(required.instance.id)

      let optionA: Awaited<ReturnType<typeof handler.create>> | undefined
      let optionB: Awaited<ReturnType<typeof handler.create>> | undefined
      if (opts.includeOptions) {
        optionA = await handler.create('line_item', {
          line_item_name: '[LP-verify] Optional A (pre-checked)',
          line_item_qty: 1,
          line_item_unit_price: OPTION_A_AMOUNT,
          line_item_taxable: false,
          line_item_optional: true,
          line_item_optional_selected: opts.aSelected ?? true,
          line_item_quote: quote.recordId,
        })
        createdLineIds.push(optionA.instance.id)

        optionB = await handler.create('line_item', {
          line_item_name: '[LP-verify] Optional B (unchecked)',
          line_item_qty: 1,
          line_item_unit_price: OPTION_B_AMOUNT,
          line_item_taxable: false,
          line_item_optional: true,
          line_item_optional_selected: opts.bSelected ?? false,
          line_item_quote: quote.recordId,
        })
        createdLineIds.push(optionB.instance.id)
      }

      await markQuoteSent({ organizationId, userId, quoteInstanceId: quote.instance.id })
      const token = await ensureQuotePublicToken(organizationId, quote.instance.id)
      return { quote, required, optionA, optionB, token }
    }

    // ── B.1/B.2/B.4: pre-checked A, unchecked B; accept selecting [B] (A absent = deselected) ──
    const b1 = await seedOptionalQuote('[LP-verify] Optional-lines quote (B1/B2/B4)', {
      includeOptions: true,
      aSelected: true,
      bSelected: false,
    })

    const b1TotalBeforeAccept = await fieldValueByAttr(
      organizationId,
      'quote',
      b1.quote.instance.id,
      'quote_total'
    )
    check(
      'B1: stored quote_total = required + A, excludes B (10000 + 5000 = 15000)',
      b1TotalBeforeAccept?.valueNumber === 15000,
      b1TotalBeforeAccept?.valueNumber
    )

    const b1Result = await acceptQuoteByToken(b1.token, {
      selectedLineIds: [b1.optionB!.instance.id],
      name: 'Verify Customer',
    })
    check(
      'B2: acceptQuoteByToken succeeds, not idempotent, converts',
      b1Result.alreadyAccepted === false && b1Result.converted === true,
      b1Result
    )

    const b1OptionAFlag = await fieldValueByAttr(
      organizationId,
      'line_item',
      b1.optionA!.instance.id,
      'line_item_optional_selected'
    )
    const b1OptionBFlag = await fieldValueByAttr(
      organizationId,
      'line_item',
      b1.optionB!.instance.id,
      'line_item_optional_selected'
    )
    check(
      'B2: flags written — A -> false (absent from selection), B -> true (selected)',
      b1OptionAFlag?.valueBoolean === false && b1OptionBFlag?.valueBoolean === true,
      { a: b1OptionAFlag?.valueBoolean, b: b1OptionBFlag?.valueBoolean }
    )

    const b1TotalAfterAccept = await fieldValueByAttr(
      organizationId,
      'quote',
      b1.quote.instance.id,
      'quote_total'
    )
    check(
      'B2: totals recomputed to required + B (10000 + 3000 = 13000)',
      b1TotalAfterAccept?.valueNumber === 13000,
      b1TotalAfterAccept?.valueNumber
    )

    const b1Status = await fieldValueByAttr(
      organizationId,
      'quote',
      b1.quote.instance.id,
      'quote_status'
    )
    check('B2: quote approved', b1Status?.optionId === 'approved', b1Status?.optionId)

    const b1WorkOrderIds = await workOrderIdsForQuote(handler, b1.quote.recordId)
    check(
      'B2: auto-convert produced exactly one work order',
      b1WorkOrderIds.length === 1,
      b1WorkOrderIds
    )
    const b1WorkOrderId = b1WorkOrderIds[0]!
    createdWorkOrderIds.push(b1WorkOrderId)
    const b1WoLineIds = await lineIdsWhere(
      handler,
      'line_item:workOrder',
      toRecordId('work_order', b1WorkOrderId)
    )
    createdLineIds.push(...b1WoLineIds)
    check(
      'B2: converted work order has exactly 2 lines (required + B only)',
      b1WoLineIds.length === 2,
      b1WoLineIds
    )
    let b1WoTotal = 0
    let b1WoCopiesCarryOptionalFlag = false
    for (const id of b1WoLineIds) {
      const priceFv = await fieldValueByAttr(
        organizationId,
        'line_item',
        id,
        'line_item_unit_price'
      )
      b1WoTotal += priceFv?.valueNumber ?? 0
      const optFv = await fieldValueByAttr(organizationId, 'line_item', id, 'line_item_optional')
      if (optFv?.valueBoolean === true) b1WoCopiesCarryOptionalFlag = true
    }
    check('B2: converted job total = required + B (13000)', b1WoTotal === 13000, b1WoTotal)
    check('B2: converted job copies carry NO optional flag', !b1WoCopiesCarryOptionalFlag)

    // ── B.3: unknown id, then required-line id, both rejected; quote stays unapproved ──
    const b3 = await seedOptionalQuote('[LP-verify] Bad-selection quote (B3)', {
      includeOptions: true,
      aSelected: true,
      bSelected: false,
    })
    const b3UnknownErr = await expectThrow(() =>
      acceptQuoteByToken(b3.token, {
        selectedLineIds: ['nonexistent-line-id-xyz'],
        name: 'Verify Customer',
      })
    )
    check(
      'B3: unknown line id -> BadRequestError',
      b3UnknownErr instanceof AuxxError &&
        /is not a selectable option/.test((b3UnknownErr as Error).message),
      b3UnknownErr
    )
    const b3RequiredErr = await expectThrow(() =>
      acceptQuoteByToken(b3.token, {
        selectedLineIds: [b3.required.instance.id],
        name: 'Verify Customer',
      })
    )
    check(
      'B3: required-line id -> BadRequestError',
      b3RequiredErr instanceof AuxxError &&
        /is not a selectable option/.test((b3RequiredErr as Error).message),
      b3RequiredErr
    )
    const b3Status = await fieldValueByAttr(
      organizationId,
      'quote',
      b3.quote.instance.id,
      'quote_status'
    )
    check(
      'B3: quote stays unapproved ("sent") after both rejections',
      b3Status?.optionId === 'sent'
    )

    // ── B.4: re-submit acceptance on the now-approved b1 quote with a DIFFERENT selection ──
    const b1Resubmit = await acceptQuoteByToken(b1.token, {
      selectedLineIds: [b1.optionA!.instance.id],
      name: 'Verify Customer',
    })
    check(
      'B4: re-submit on an approved quote is an idempotent early return',
      b1Resubmit.alreadyAccepted === true && b1Resubmit.converted === false,
      b1Resubmit
    )
    const b1OptionAFlagAfterResubmit = await fieldValueByAttr(
      organizationId,
      'line_item',
      b1.optionA!.instance.id,
      'line_item_optional_selected'
    )
    const b1OptionBFlagAfterResubmit = await fieldValueByAttr(
      organizationId,
      'line_item',
      b1.optionB!.instance.id,
      'line_item_optional_selected'
    )
    check(
      'B4: selections unchanged by the idempotent re-submit',
      b1OptionAFlagAfterResubmit?.valueBoolean === false &&
        b1OptionBFlagAfterResubmit?.valueBoolean === true,
      { a: b1OptionAFlagAfterResubmit?.valueBoolean, b: b1OptionBFlagAfterResubmit?.valueBoolean }
    )

    // ── B.5: empty selectedLineIds on a fresh quote deselects every optional line ──
    const b5 = await seedOptionalQuote('[LP-verify] Empty-selection quote (B5)', {
      includeOptions: true,
      aSelected: true,
      bSelected: true,
    })
    const b5Result = await acceptQuoteByToken(b5.token, {
      selectedLineIds: [],
      name: 'Verify Customer',
    })
    check(
      'B5: empty selection accepts and converts',
      b5Result.alreadyAccepted === false && b5Result.converted === true,
      b5Result
    )
    const b5OptionAFlag = await fieldValueByAttr(
      organizationId,
      'line_item',
      b5.optionA!.instance.id,
      'line_item_optional_selected'
    )
    const b5OptionBFlag = await fieldValueByAttr(
      organizationId,
      'line_item',
      b5.optionB!.instance.id,
      'line_item_optional_selected'
    )
    check(
      'B5: every optional line deselected',
      b5OptionAFlag?.valueBoolean === false && b5OptionBFlag?.valueBoolean === false,
      { a: b5OptionAFlag?.valueBoolean, b: b5OptionBFlag?.valueBoolean }
    )
    const b5Total = await fieldValueByAttr(
      organizationId,
      'quote',
      b5.quote.instance.id,
      'quote_total'
    )
    check('B5: total = required only (10000)', b5Total?.valueNumber === 10000, b5Total?.valueNumber)
    const b5WorkOrderIds = await workOrderIdsForQuote(handler, b5.quote.recordId)
    check('B5: converted', b5WorkOrderIds.length === 1, b5WorkOrderIds)
    const b5WorkOrderId = b5WorkOrderIds[0]!
    createdWorkOrderIds.push(b5WorkOrderId)
    const b5WoLineIds = await lineIdsWhere(
      handler,
      'line_item:workOrder',
      toRecordId('work_order', b5WorkOrderId)
    )
    createdLineIds.push(...b5WoLineIds)
    check('B5: converted job has only the required line', b5WoLineIds.length === 1, b5WoLineIds)

    // ── B.6: zero-optional quote + undefined selectedLineIds accepts exactly as before ──
    const b6 = await seedOptionalQuote('[LP-verify] Zero-optional quote (B6)', {
      includeOptions: false,
    })
    const b6TotalBefore = await fieldValueByAttr(
      organizationId,
      'quote',
      b6.quote.instance.id,
      'quote_total'
    )
    check('B6: total = required only before accept (10000)', b6TotalBefore?.valueNumber === 10000)
    const b6Result = await acceptQuoteByToken(b6.token, { name: 'Verify Customer' })
    check(
      'B6: zero-optional quote accepts and converts with undefined selectedLineIds',
      b6Result.alreadyAccepted === false && b6Result.converted === true,
      b6Result
    )
    const b6TotalAfter = await fieldValueByAttr(
      organizationId,
      'quote',
      b6.quote.instance.id,
      'quote_total'
    )
    check(
      'B6: totals untouched by accept (still 10000, no selection write)',
      b6TotalAfter?.valueNumber === 10000,
      b6TotalAfter?.valueNumber
    )
    const b6WorkOrderIds = await workOrderIdsForQuote(handler, b6.quote.recordId)
    if (b6WorkOrderIds[0]) createdWorkOrderIds.push(b6WorkOrderIds[0])
    const b6WoLineIds = b6WorkOrderIds[0]
      ? await lineIdsWhere(
          handler,
          'line_item:workOrder',
          toRecordId('work_order', b6WorkOrderIds[0])
        )
      : []
    createdLineIds.push(...b6WoLineIds)
    check('B6: converted job has only the required line', b6WoLineIds.length === 1, b6WoLineIds)

    // ══════════════════════════════════════════════════════════════════════
    // C. Part-cost → catalog pricing (17 §7)
    // ══════════════════════════════════════════════════════════════════════
    console.log('C: part-cost -> catalog pricing sync')

    const vendorCompany = await handler.create('company', {
      company_name: '[LP-verify] Vendor Co',
    })
    createdCompanyIds.push(vendorCompany.instance.id)

    const part = await handler.create('part', {
      part_title: '[LP-verify] Widget',
      part_sku: `LP-VERIFY-PART-${Date.now()}`,
    })
    createdPartIds.push(part.instance.id)

    const catMarkup = await handler.create('catalog_item', {
      catalog_item_name: '[LP-verify] Catalog item WITH markup',
      catalog_item_part: toRecordId('part', part.instance.id),
      catalog_item_markup: 50,
    })
    createdCatalogItemIds.push(catMarkup.instance.id)

    const catNoMarkup = await handler.create('catalog_item', {
      catalog_item_name: '[LP-verify] Catalog item WITHOUT markup',
      catalog_item_part: toRecordId('part', part.instance.id),
    })
    createdCatalogItemIds.push(catNoMarkup.instance.id)

    // "Existing quote line picked from that item earlier" — an already-priced line snapshot
    // that must be untouched by any later repricing (decision 5).
    const quotePriceCheck = await handler.create('quote', {
      quote_title: '[LP-verify] Price-check quote',
      quote_contact: contactRecordId,
    })
    createdQuoteIds.push(quotePriceCheck.instance.id)
    const linePriceCheck = await handler.create('line_item', {
      line_item_name: '[LP-verify] Picked-earlier line',
      line_item_qty: 1,
      line_item_unit_price: 4242,
      line_item_taxable: false,
      line_item_catalog_item: toRecordId('catalog_item', catMarkup.instance.id),
      line_item_quote: quotePriceCheck.recordId,
    })
    createdLineIds.push(linePriceCheck.instance.id)

    const vendorPart = await handler.create('vendor_part', {
      vendor_part_part: toRecordId('part', part.instance.id),
      vendor_part_contact: toRecordId('company', vendorCompany.instance.id),
      vendor_part_vendor_sku: `LP-VERIFY-VP-${Date.now()}`,
      vendor_part_unit_price: 1000,
      vendor_part_is_preferred: true,
    })
    createdVendorPartIds.push(vendorPart.instance.id)

    // C.1 — trigger the real recalc by CHANGING the vendor price (a genuine "changed" event —
    // the synchronous `mfg-vendor-part-unit-price` field-system-rule fires
    // `recalculatePartCost` -> `recalculateAffectedParts` -> `syncCatalogItemPricing`, all
    // awaited inline by the time `handler.update` resolves).
    await handler.update(toRecordId('vendor_part', vendorPart.instance.id), {
      vendor_part_unit_price: 2000,
    })

    const partCost = await fieldValueByAttr(organizationId, 'part', part.instance.id, 'part_cost')
    check(
      'C1: part_cost recalculated to landed cost (2000)',
      partCost?.valueNumber === 2000,
      partCost?.valueNumber
    )

    const catMarkupCost = await fieldValueByAttr(
      organizationId,
      'catalog_item',
      catMarkup.instance.id,
      'catalog_item_cost'
    )
    const catNoMarkupCost = await fieldValueByAttr(
      organizationId,
      'catalog_item',
      catNoMarkup.instance.id,
      'catalog_item_cost'
    )
    check(
      'C1: BOTH catalog items cost-synced to 2000',
      catMarkupCost?.valueNumber === 2000 && catNoMarkupCost?.valueNumber === 2000,
      { markup: catMarkupCost?.valueNumber, noMarkup: catNoMarkupCost?.valueNumber }
    )

    const catMarkupPrice = await fieldValueByAttr(
      organizationId,
      'catalog_item',
      catMarkup.instance.id,
      'catalog_item_default_unit_price'
    )
    check(
      'C1: ONLY the markup item price recomputes — round(2000 * 1.5) = 3000',
      catMarkupPrice?.valueNumber === 3000,
      catMarkupPrice?.valueNumber
    )
    const catNoMarkupPrice = await fieldValueByAttr(
      organizationId,
      'catalog_item',
      catNoMarkup.instance.id,
      'catalog_item_default_unit_price'
    )
    check(
      'C1: no-markup item price untouched (still unset)',
      catNoMarkupPrice === null,
      catNoMarkupPrice
    )

    // C.2 — the pre-existing quote line's own unit_price is untouched by the repricing.
    const linePriceCheckAfter = await fieldValueByAttr(
      organizationId,
      'line_item',
      linePriceCheck.instance.id,
      'line_item_unit_price'
    )
    check(
      'C2: existing quote line untouched by repricing (still 4242)',
      linePriceCheckAfter?.valueNumber === 4242,
      linePriceCheckAfter?.valueNumber
    )

    // C.3 — migration idempotency spot-check.
    const migration044 = ALL_ENTITY_MIGRATIONS.find((m) => m.id === '044-line-pricing-fields')
    if (!migration044) throw new Error('Migration 044 not found in registry')
    const migrationRun1 = await migration044.up(database, organizationId)
    check(
      'C3: migration 044 re-run #1 is alreadyUpToDate',
      migrationRun1.alreadyUpToDate === true,
      migrationRun1
    )
    const migrationRun2 = await migration044.up(database, organizationId)
    check(
      'C3: migration 044 re-run #2 is alreadyUpToDate',
      migrationRun2.alreadyUpToDate === true,
      migrationRun2
    )
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────────
    console.log(
      `Cleanup: ${createdInvoiceIds.length} invoices, ${createdLineIds.length} lines, ` +
        `${createdWorkOrderIds.length} work orders, ${createdQuoteIds.length} quotes, ` +
        `${createdCatalogItemIds.length} catalog items, ${createdVendorPartIds.length} vendor parts, ` +
        `${createdPartIds.length} parts, ${createdCompanyIds.length} companies, ` +
        `${createdContactIds.length} contacts`
    )
    // Invoices BEFORE lines: `InvoiceLineAllocation.sourceLineItemId` is a restrict FK, freed
    // only once the owning invoice cascades its allocation rows away (deposit-allocations
    // script's precedent).
    for (const id of [...new Set(createdInvoiceIds)]) {
      try {
        await handler.delete(toRecordId('invoice', id))
      } catch (err) {
        console.log(`  cleanup failed for invoice:${id}:`, err instanceof Error ? err.message : err)
      }
    }
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
    for (const id of [...new Set(createdWorkOrderIds)]) {
      try {
        await handler.delete(toRecordId('work_order', id))
      } catch (err) {
        console.log(
          `  cleanup failed for work_order:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of [...new Set(createdQuoteIds)]) {
      try {
        await handler.delete(toRecordId('quote', id))
      } catch (err) {
        console.log(`  cleanup failed for quote:${id}:`, err instanceof Error ? err.message : err)
      }
    }
    for (const id of [...new Set(createdCatalogItemIds)]) {
      try {
        await handler.delete(toRecordId('catalog_item', id))
      } catch (err) {
        console.log(
          `  cleanup failed for catalog_item:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of [...new Set(createdVendorPartIds)]) {
      try {
        await handler.delete(toRecordId('vendor_part', id))
      } catch (err) {
        console.log(
          `  cleanup failed for vendor_part:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of [...new Set(createdPartIds)]) {
      try {
        await handler.delete(toRecordId('part', id))
      } catch (err) {
        console.log(`  cleanup failed for part:${id}:`, err instanceof Error ? err.message : err)
      }
    }
    for (const id of [...new Set(createdCompanyIds)]) {
      try {
        await handler.delete(toRecordId('company', id))
      } catch (err) {
        console.log(`  cleanup failed for company:${id}:`, err instanceof Error ? err.message : err)
      }
    }
    for (const id of [...new Set(createdContactIds)]) {
      try {
        await handler.delete(toRecordId('contact', id))
      } catch (err) {
        console.log(`  cleanup failed for contact:${id}:`, err instanceof Error ? err.message : err)
      }
    }

    // Restore any org settings this script changed, byte-exact.
    if (acceptancePageOverridden) {
      await updateOrganizationSetting({
        organizationId,
        key: 'documents.quote.acceptancePageEnabled',
        value: (originalAcceptancePageEnabled ?? true) as boolean,
      }).catch(() => {})
      await getOrgCache()
        .invalidateAndRecompute(organizationId, ['orgSettings'])
        .catch(() => {})
    }
    if (autoConvertOverridden) {
      await updateOrganizationSetting({
        organizationId,
        key: 'documents.quote.autoConvertOnAccept',
        value: (originalAutoConvertOnAccept ?? true) as boolean,
      }).catch(() => {})
      await getOrgCache()
        .invalidateAndRecompute(organizationId, ['orgSettings'])
        .catch(() => {})
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
