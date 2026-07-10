// apps/worker/scripts/verify-money-mi1.ts
/**
 * Money MI1 (Invoicing Records) end-to-end verification (plans/dispatch/money/06-mi1-build.md
 * §L, items 2–6). Exercises the REAL write paths: UnifiedCrudHandler.create/update/delete (INV
 * number pre-hook, invoice lifecycle-guard pre-hooks, the payment provenance guard), the
 * generalized totals-engine field-change hooks (line_item_invoice trigger, the §G.1
 * WO-source-line-never-recomputes-invoice guard), the payment ledger (recordManualPayment /
 * deleteManualPayment / syncInvoicePaymentState), gather (listUninvoicedLines /
 * createInvoiceFromWorkOrder / deleteInvoiceLine), and invoice lifecycle (voidInvoice /
 * deleteInvoice) including the full-unstamp semantics and the PaymentTransaction FK restrict.
 *
 * Creates records prefixed "[MI1-verify]" and deletes them at the end (try/finally).
 *
 * Run (from repo root) under the worker runtime:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/verify-money-mi1.ts
 */

import { database } from '@auxx/database'
import { onCacheEvent } from '@auxx/lib/cache'
import { AuxxError } from '@auxx/lib/errors'
import {
  computeDocumentTotals,
  createInvoiceFromWorkOrder,
  deleteInvoice,
  deleteInvoiceLine,
  deleteManualPayment,
  listUninvoicedLines,
  recordManualPayment,
  voidInvoice,
} from '@auxx/lib/money'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
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

async function instanceExists(instanceId: string): Promise<boolean> {
  const row = await database.query.EntityInstance.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.id, instanceId),
  })
  return !!row
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — same as MQ1 script)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const today = new Date().toISOString().split('T')[0]!

  const createdLineIds: string[] = []
  const createdInvoiceIds: string[] = []
  const createdWorkOrderIds: string[] = []
  const createdQuoteIds: string[] = []
  const createdTransactionIds: string[] = []
  let taxRatesChanged = false
  let originalTaxRates: unknown = null

  try {
    const contactDefId = await entityDefId(organizationId, 'contact')
    const contact = contactDefId
      ? await database.query.EntityInstance.findFirst({
          columns: { id: true },
          where: (t, { eq }) => eq(t.entityDefinitionId, contactDefId),
        })
      : null
    if (!contact) throw new Error('No contact in org — cannot test invoices')
    const contactRecordId = toRecordId('contact', contact.id)

    // ── 1: INV numbering + status guards (§L.2) ────────────────────────────
    console.log('1: INV numbering + status guards')
    const inv1 = await handler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(inv1.instance.id)
    const inv1Number = await fieldValueByAttr(
      organizationId,
      'invoice',
      inv1.instance.id,
      'invoice_number'
    )
    check(
      `invoice_number auto-assigned (${inv1Number?.valueText})`,
      !!inv1Number?.valueText?.startsWith('INV-')
    )

    const inv2 = await handler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(inv2.instance.id)
    const inv2Number = await fieldValueByAttr(
      organizationId,
      'invoice',
      inv2.instance.id,
      'invoice_number'
    )
    check(
      `second invoice increments (${inv1Number?.valueText} -> ${inv2Number?.valueText})`,
      !!inv2Number?.valueText && inv2Number.valueText !== inv1Number?.valueText
    )

    const invoiceStatusFieldId = await fieldId(organizationId, 'invoice', 'invoice_status')
    if (!invoiceStatusFieldId) throw new Error('invoice_status field not found')
    const inv1RecordId = toRecordId('invoice', inv1.instance.id)

    for (const guarded of ['sent', 'partially_paid', 'paid', 'void']) {
      const errAttr = await expectThrow(() =>
        handler.update(inv1RecordId, { invoice_status: guarded })
      )
      check(
        `manual invoice_status=${guarded} rejected (systemAttribute-keyed)`,
        errAttr instanceof AuxxError
      )

      const errField = await expectThrow(() =>
        handler.update(inv1RecordId, { [invoiceStatusFieldId]: guarded })
      )
      check(
        `manual invoice_status=${guarded} rejected (fieldId-keyed)`,
        errField instanceof AuxxError
      )
    }

    const draftErr = await expectThrow(() =>
      handler.update(inv1RecordId, { invoice_status: 'draft' })
    )
    check('manual invoice_status=draft allowed', draftErr === undefined, draftErr)

    // Generic payment create without payment_transaction_id — rejected.
    const noProvenanceErr = await expectThrow(() =>
      handler.create('payment', {
        payment_amount: 500,
        payment_date: today,
        payment_method: 'cash',
        payment_invoice: inv1RecordId,
      })
    )
    check(
      'generic payment create without payment_transaction_id rejected',
      noProvenanceErr instanceof AuxxError &&
        /Record payment action/.test((noProvenanceErr as Error).message)
    )

    // Existing payment mirror (via the ledger) — payment_amount update rejected.
    // (Needs a nonzero balance — give inv1 a line first, else recordManualPayment rejects
    // as an overpay against a zero-total invoice.)
    const guardLine = await handler.create('line_item', {
      line_item_name: '[MI1-verify] Guard-section line',
      line_item_qty: 1,
      line_item_unit_price: 100,
      line_item_taxable: false,
      line_item_invoice: inv1RecordId,
    })
    createdLineIds.push(guardLine.instance.id)

    const guardPayment = await recordManualPayment({
      organizationId,
      userId,
      invoiceInstanceId: inv1.instance.id,
      amount: 100,
      date: today,
      method: 'cash',
    })
    createdTransactionIds.push(guardPayment.transactionId)
    const guardTxRow = await database.query.PaymentTransaction.findFirst({
      where: (t, { eq }) => eq(t.id, guardPayment.transactionId),
    })
    check('recordManualPayment stamped paymentInstanceId', !!guardTxRow?.paymentInstanceId)

    const paymentInstanceId = guardTxRow!.paymentInstanceId!
    const mirrorUpdateErr = await expectThrow(() =>
      handler.update(toRecordId('payment', paymentInstanceId), { payment_amount: 999 })
    )
    check(
      'payment_amount update on existing payment mirror rejected',
      mirrorUpdateErr instanceof AuxxError
    )

    // Clean this guard-only payment back out so inv1 carries no ledger rows into cleanup.
    await deleteManualPayment({ organizationId, userId, transactionId: guardPayment.transactionId })
    check(
      'deleteManualPayment (guard section) removed the mirror entity',
      !(await instanceExists(paymentInstanceId))
    )

    // ── 2: Totals engine on invoices (§L.3) ─────────────────────────────────
    console.log('2: totals engine (invoice)')
    const totalsInvoice = await handler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(totalsInvoice.instance.id)
    const totalsInvoiceRecordId = toRecordId('invoice', totalsInvoice.instance.id)

    const lineA = await handler.create('line_item', {
      line_item_name: '[MI1-verify] Invoice line A (taxable)',
      line_item_qty: 2,
      line_item_unit_price: 5000,
      line_item_taxable: true,
      line_item_invoice: totalsInvoiceRecordId,
    })
    createdLineIds.push(lineA.instance.id)
    const lineB = await handler.create('line_item', {
      line_item_name: '[MI1-verify] Invoice line B (non-taxable)',
      line_item_qty: 1,
      line_item_unit_price: 10000,
      line_item_taxable: false,
      line_item_invoice: totalsInvoiceRecordId,
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
      'line A lineTotal = 10000 (2 x 5000)',
      lineATotal?.valueNumber === 10000,
      lineATotal?.valueNumber
    )
    check(
      'line B lineTotal = 10000 (1 x 10000)',
      lineBTotal?.valueNumber === 10000,
      lineBTotal?.valueNumber
    )

    const subtotalAfterLines = await fieldValueByAttr(
      organizationId,
      'invoice',
      totalsInvoice.instance.id,
      'invoice_subtotal'
    )
    check(
      'invoice_subtotal = 20000 after two lines',
      subtotalAfterLines?.valueNumber === 20000,
      subtotalAfterLines?.valueNumber
    )

    await handler.update(totalsInvoiceRecordId, {
      invoice_discount_type: 'percent',
      invoice_discount_value: 10,
      invoice_tax_rate: 7.5,
    })

    const expected = computeDocumentTotals(
      [
        { lineTotal: 10000, taxable: true },
        { lineTotal: 10000, taxable: false },
      ],
      { discountType: 'percent', discountValue: 10, taxRate: 7.5 }
    )
    check(
      'computeDocumentTotals sanity: subtotal 20000, discount 2000, tax 675, total 18675',
      expected.subtotal === 20000 &&
        expected.discountAmount === 2000 &&
        expected.taxTotal === 675 &&
        expected.total === 18675,
      expected
    )

    const invSubtotal = await fieldValueByAttr(
      organizationId,
      'invoice',
      totalsInvoice.instance.id,
      'invoice_subtotal'
    )
    const invTaxTotal = await fieldValueByAttr(
      organizationId,
      'invoice',
      totalsInvoice.instance.id,
      'invoice_tax_total'
    )
    const invTotal = await fieldValueByAttr(
      organizationId,
      'invoice',
      totalsInvoice.instance.id,
      'invoice_total'
    )
    check(
      'invoice_subtotal = 20000 after billing change',
      invSubtotal?.valueNumber === 20000,
      invSubtotal?.valueNumber
    )
    check(
      'invoice_tax_total = 675 after billing change',
      invTaxTotal?.valueNumber === 675,
      invTaxTotal?.valueNumber
    )
    check(
      'invoice_total = 18675 after billing change',
      invTotal?.valueNumber === 18675,
      invTotal?.valueNumber
    )

    await deleteInvoiceLine({ organizationId, userId, lineInstanceId: lineB.instance.id })
    createdLineIds.splice(createdLineIds.indexOf(lineB.instance.id), 1)

    // Only line A (taxable, 10000) remains: subtotal 10000, discount 10% = 1000,
    // taxBase = 10000 * (1 - 1000/10000) = 9000, tax = 9000 * 0.075 = 675, total = 10000-1000+675 = 9675.
    const subtotalAfterDelete = await fieldValueByAttr(
      organizationId,
      'invoice',
      totalsInvoice.instance.id,
      'invoice_subtotal'
    )
    const totalAfterDelete = await fieldValueByAttr(
      organizationId,
      'invoice',
      totalsInvoice.instance.id,
      'invoice_total'
    )
    check(
      'invoice_subtotal drops to 10000 after deleteInvoiceLine',
      subtotalAfterDelete?.valueNumber === 10000,
      subtotalAfterDelete?.valueNumber
    )
    check(
      'invoice_total drops to 9675 after deleteInvoiceLine',
      totalAfterDelete?.valueNumber === 9675,
      totalAfterDelete?.valueNumber
    )

    // Critical §G.1 assert: stamping a WORK-ORDER line's line_item_invoice (as gather does)
    // must NEVER recompute the invoice's totals.
    const woAssert = await handler.create('work_order', {
      work_order_title: '[MI1-verify] WO for §G.1 assert',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(woAssert.instance.id)
    const lineAssert = await handler.create('line_item', {
      line_item_name: '[MI1-verify] WO source line (should never recompute invoice)',
      line_item_qty: 5,
      line_item_unit_price: 1000,
      line_item_taxable: true,
      line_item_work_order: toRecordId('work_order', woAssert.instance.id),
    })
    createdLineIds.push(lineAssert.instance.id)

    const baselineSubtotal = await fieldValueByAttr(
      organizationId,
      'invoice',
      totalsInvoice.instance.id,
      'invoice_subtotal'
    )
    const baselineTotal = await fieldValueByAttr(
      organizationId,
      'invoice',
      totalsInvoice.instance.id,
      'invoice_total'
    )

    await handler.update(toRecordId('line_item', lineAssert.instance.id), {
      line_item_invoice: totalsInvoiceRecordId,
    })

    const afterStampSubtotal = await fieldValueByAttr(
      organizationId,
      'invoice',
      totalsInvoice.instance.id,
      'invoice_subtotal'
    )
    const afterStampTotal = await fieldValueByAttr(
      organizationId,
      'invoice',
      totalsInvoice.instance.id,
      'invoice_total'
    )
    check(
      'WO source-line stamp (line_item_invoice, workOrder set) does NOT recompute invoice totals (§G.1 guard)',
      afterStampSubtotal?.valueNumber === baselineSubtotal?.valueNumber &&
        afterStampTotal?.valueNumber === baselineTotal?.valueNumber,
      {
        baselineSubtotal: baselineSubtotal?.valueNumber,
        afterStampSubtotal: afterStampSubtotal?.valueNumber,
      }
    )

    // ── 3: Ledger loop (§L.4) ────────────────────────────────────────────────
    console.log('3: ledger loop')
    const ledgerInvoice = await handler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(ledgerInvoice.instance.id)
    const ledgerLine = await handler.create('line_item', {
      line_item_name: '[MI1-verify] Ledger invoice line',
      line_item_qty: 1,
      line_item_unit_price: 10000,
      line_item_taxable: false,
      line_item_invoice: toRecordId('invoice', ledgerInvoice.instance.id),
    })
    createdLineIds.push(ledgerLine.instance.id)

    const ledgerInvoiceTotal = await fieldValueByAttr(
      organizationId,
      'invoice',
      ledgerInvoice.instance.id,
      'invoice_total'
    )
    check(
      'ledger invoice baseline total = 10000',
      ledgerInvoiceTotal?.valueNumber === 10000,
      ledgerInvoiceTotal?.valueNumber
    )

    const pay1 = await recordManualPayment({
      organizationId,
      userId,
      invoiceInstanceId: ledgerInvoice.instance.id,
      amount: 4000,
      date: today,
      method: 'cash',
    })
    createdTransactionIds.push(pay1.transactionId)
    const pay1Row = await database.query.PaymentTransaction.findFirst({
      where: (t, { eq }) => eq(t.id, pay1.transactionId),
    })
    check(
      'pay1 ledger row succeeded/manual/charge',
      pay1Row?.status === 'succeeded' &&
        pay1Row?.provider === 'manual' &&
        pay1Row?.kind === 'charge'
    )
    check('pay1 created a payment mirror', !!pay1Row?.paymentInstanceId)
    const pay1MirrorAmount = pay1Row?.paymentInstanceId
      ? await fieldValueByAttr(
          organizationId,
          'payment',
          pay1Row.paymentInstanceId,
          'payment_amount'
        )
      : null
    check(
      'pay1 mirror payment_amount = 4000',
      pay1MirrorAmount?.valueNumber === 4000,
      pay1MirrorAmount?.valueNumber
    )

    const amountPaidAfterPay1 = await fieldValueByAttr(
      organizationId,
      'invoice',
      ledgerInvoice.instance.id,
      'invoice_amount_paid'
    )
    const balanceAfterPay1 = await fieldValueByAttr(
      organizationId,
      'invoice',
      ledgerInvoice.instance.id,
      'invoice_balance'
    )
    const statusAfterPay1 = await fieldValueByAttr(
      organizationId,
      'invoice',
      ledgerInvoice.instance.id,
      'invoice_status'
    )
    check(
      'invoice_amount_paid = 4000 after pay1',
      amountPaidAfterPay1?.valueNumber === 4000,
      amountPaidAfterPay1?.valueNumber
    )
    check(
      'invoice_balance = 6000 after pay1',
      balanceAfterPay1?.valueNumber === 6000,
      balanceAfterPay1?.valueNumber
    )
    check(
      "invoice_status = 'partially_paid' after pay1",
      statusAfterPay1?.optionId === 'partially_paid',
      statusAfterPay1?.optionId
    )

    const pay2 = await recordManualPayment({
      organizationId,
      userId,
      invoiceInstanceId: ledgerInvoice.instance.id,
      amount: 6000,
      date: today,
      method: 'card',
    })
    createdTransactionIds.push(pay2.transactionId)
    const balanceAfterPay2 = await fieldValueByAttr(
      organizationId,
      'invoice',
      ledgerInvoice.instance.id,
      'invoice_balance'
    )
    const statusAfterPay2 = await fieldValueByAttr(
      organizationId,
      'invoice',
      ledgerInvoice.instance.id,
      'invoice_status'
    )
    check(
      'invoice_balance = 0 after pay2 (exact remainder)',
      balanceAfterPay2?.valueNumber === 0,
      balanceAfterPay2?.valueNumber
    )
    check(
      "invoice_status = 'paid' after pay2",
      statusAfterPay2?.optionId === 'paid',
      statusAfterPay2?.optionId
    )

    const overpayErr = await expectThrow(() =>
      recordManualPayment({
        organizationId,
        userId,
        invoiceInstanceId: ledgerInvoice.instance.id,
        amount: 1,
        date: today,
        method: 'cash',
      })
    )
    check('overpay rejected', overpayErr instanceof AuxxError)

    // Payment on a void invoice — rejected.
    const voidTestInvoice = await handler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(voidTestInvoice.instance.id)
    await voidInvoice({ organizationId, userId, invoiceInstanceId: voidTestInvoice.instance.id })
    const voidPaymentErr = await expectThrow(() =>
      recordManualPayment({
        organizationId,
        userId,
        invoiceInstanceId: voidTestInvoice.instance.id,
        amount: 100,
        date: today,
        method: 'cash',
      })
    )
    check(
      'payment on void invoice rejected',
      voidPaymentErr instanceof AuxxError && /void invoice/.test((voidPaymentErr as Error).message)
    )

    // deleteManualPayment on a non-manual row — ForbiddenError, then flip back.
    // (Plain SQL via `database.$client` — `apps/worker` has no direct `drizzle-orm` dependency,
    // the `verify-availability.ts` precedent.)
    await database.$client.query('UPDATE "PaymentTransaction" SET provider = $1 WHERE id = $2', [
      'stripe',
      pay1.transactionId,
    ])
    const nonManualErr = await expectThrow(() =>
      deleteManualPayment({ organizationId, userId, transactionId: pay1.transactionId })
    )
    check(
      'deleteManualPayment on a non-manual (stripe) row rejected (ForbiddenError)',
      nonManualErr instanceof AuxxError && /refunded/i.test((nonManualErr as Error).message)
    )
    await database.$client.query('UPDATE "PaymentTransaction" SET provider = $1 WHERE id = $2', [
      'manual',
      pay1.transactionId,
    ])

    // Reverse-delete chain: paid -> partially_paid -> sent.
    await deleteManualPayment({ organizationId, userId, transactionId: pay2.transactionId })
    const amountPaidAfterDelPay2 = await fieldValueByAttr(
      organizationId,
      'invoice',
      ledgerInvoice.instance.id,
      'invoice_amount_paid'
    )
    const statusAfterDelPay2 = await fieldValueByAttr(
      organizationId,
      'invoice',
      ledgerInvoice.instance.id,
      'invoice_status'
    )
    check(
      'deleteManualPayment(pay2) reverts paid -> partially_paid, amountPaid back to 4000',
      amountPaidAfterDelPay2?.valueNumber === 4000 &&
        statusAfterDelPay2?.optionId === 'partially_paid',
      { amountPaid: amountPaidAfterDelPay2?.valueNumber, status: statusAfterDelPay2?.optionId }
    )

    await deleteManualPayment({ organizationId, userId, transactionId: pay1.transactionId })
    const amountPaidAfterDelPay1 = await fieldValueByAttr(
      organizationId,
      'invoice',
      ledgerInvoice.instance.id,
      'invoice_amount_paid'
    )
    const statusAfterDelPay1 = await fieldValueByAttr(
      organizationId,
      'invoice',
      ledgerInvoice.instance.id,
      'invoice_status'
    )
    check(
      "deleteManualPayment(pay1) — all payments gone lands on 'sent' (documented revert target)",
      amountPaidAfterDelPay1?.valueNumber === 0 && statusAfterDelPay1?.optionId === 'sent',
      { amountPaid: amountPaidAfterDelPay1?.valueNumber, status: statusAfterDelPay1?.optionId }
    )

    // ── 4: Gather (§L.5) ─────────────────────────────────────────────────────
    console.log('4: gather uninvoiced lines')
    const gatherQuote = await handler.create('quote', {
      quote_title: '[MI1-verify] Gather quote',
      quote_contact: contactRecordId,
      quote_tax_name: 'MI1 Gather Tax',
      quote_tax_rate: 8.25,
    })
    createdQuoteIds.push(gatherQuote.instance.id)
    const woGather = await handler.create('work_order', {
      work_order_title: '[MI1-verify] Gather WO',
      work_order_contact: contactRecordId,
      work_order_quote: toRecordId('quote', gatherQuote.instance.id),
    })
    createdWorkOrderIds.push(woGather.instance.id)
    const woGatherRecordId = toRecordId('work_order', woGather.instance.id)

    const lineJob1 = await handler.create('line_item', {
      line_item_name: '[MI1-verify] Job-set line 1',
      line_item_qty: 1,
      line_item_unit_price: 2000,
      line_item_taxable: true,
      line_item_sort_order: 10,
      line_item_work_order: woGatherRecordId,
    })
    createdLineIds.push(lineJob1.instance.id)
    const lineJob2 = await handler.create('line_item', {
      line_item_name: '[MI1-verify] Job-set line 2',
      line_item_qty: 1,
      line_item_unit_price: 3000,
      line_item_taxable: true,
      line_item_sort_order: 20,
      line_item_work_order: woGatherRecordId,
    })
    createdLineIds.push(lineJob2.instance.id)
    const lineVisit1 = await handler.create('line_item', {
      line_item_name: '[MI1-verify] Visit-extra line 1',
      line_item_qty: 1,
      line_item_unit_price: 1500,
      line_item_taxable: true,
      line_item_sort_order: 30,
      line_item_visit_id: 'mi1-verify-visit-1',
      line_item_work_order: woGatherRecordId,
    })
    createdLineIds.push(lineVisit1.instance.id)
    const lineVisit2 = await handler.create('line_item', {
      line_item_name: '[MI1-verify] Visit-extra line 2',
      line_item_qty: 1,
      line_item_unit_price: 2500,
      line_item_taxable: true,
      line_item_sort_order: 40,
      line_item_visit_id: 'mi1-verify-visit-2',
      line_item_work_order: woGatherRecordId,
    })
    createdLineIds.push(lineVisit2.instance.id)

    const uninvoiced1 = await listUninvoicedLines({
      organizationId,
      userId,
      workOrderInstanceId: woGather.instance.id,
    })
    check(
      'listUninvoicedLines returns all 4 lines before gather',
      uninvoiced1.length === 4,
      uninvoiced1.length
    )

    const gatherResult = await createInvoiceFromWorkOrder({
      organizationId,
      userId,
      workOrderInstanceId: woGather.instance.id,
      lineInstanceIds: [lineJob1.instance.id, lineJob2.instance.id, lineVisit1.instance.id],
    })
    createdInvoiceIds.push(gatherResult.instanceId)

    const gatherInvoiceRecordId = gatherResult.recordId
    const ownedCopies = await handler.listFiltered({
      entityDefinitionId: 'line_item',
      filters: [
        {
          id: 'gather-owned-lines',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'c1',
              fieldId: 'line_item:invoice',
              operator: 'is',
              value: gatherInvoiceRecordId,
            },
            { id: 'c2', fieldId: 'line_item:workOrder', operator: 'empty', value: null },
          ],
        },
      ],
      limit: 100,
      mode: 'oneshot',
    })
    for (const id of ownedCopies.ids) createdLineIds.push(id)
    check(
      'gather produced exactly 3 owned invoice-line copies',
      ownedCopies.ids.length === 3,
      ownedCopies.ids.length
    )

    const sourceIdsBySortOrder = new Map([
      [lineJob1.instance.id, 10],
      [lineJob2.instance.id, 20],
      [lineVisit1.instance.id, 30],
    ])
    let allCopiesWellFormed = true
    for (const copyId of ownedCopies.ids) {
      const sourceLineIdFv = await fieldValueByAttr(
        organizationId,
        'line_item',
        copyId,
        'line_item_source_line_id'
      )
      const sourceLineId = sourceLineIdFv?.valueText
      const sortOrderFv = await fieldValueByAttr(
        organizationId,
        'line_item',
        copyId,
        'line_item_sort_order'
      )
      const workOrderFv = await fieldValueByAttr(
        organizationId,
        'line_item',
        copyId,
        'line_item_work_order'
      )
      const expectedSort = sourceLineId ? sourceIdsBySortOrder.get(sourceLineId) : undefined
      if (!sourceLineId || !sourceIdsBySortOrder.has(sourceLineId)) allCopiesWellFormed = false
      if (workOrderFv?.relatedEntityId) allCopiesWellFormed = false
      if (expectedSort !== undefined && sortOrderFv?.valueNumber !== expectedSort)
        allCopiesWellFormed = false
    }
    check('each copy: workOrder empty, sourceLineId set, sortOrder preserved', allCopiesWellFormed)

    let allSourcesStamped = true
    for (const sourceId of [lineJob1.instance.id, lineJob2.instance.id, lineVisit1.instance.id]) {
      const invoiceFv = await fieldValueByAttr(
        organizationId,
        'line_item',
        sourceId,
        'line_item_invoice'
      )
      if (invoiceFv?.relatedEntityId !== gatherResult.instanceId) allSourcesStamped = false
    }
    check('all 3 gathered sources stamped with line_item_invoice', allSourcesStamped)

    const uninvoiced2 = await listUninvoicedLines({
      organizationId,
      userId,
      workOrderInstanceId: woGather.instance.id,
    })
    check(
      'listUninvoicedLines returns exactly 1 (lineVisit2) after gather',
      uninvoiced2.length === 1 && uninvoiced2[0]?.instanceId === lineVisit2.instance.id,
      uninvoiced2.map((l) => l.instanceId)
    )

    const gatherInvoiceTaxName = await fieldValueByAttr(
      organizationId,
      'invoice',
      gatherResult.instanceId,
      'invoice_tax_name'
    )
    const gatherInvoiceTaxRate = await fieldValueByAttr(
      organizationId,
      'invoice',
      gatherResult.instanceId,
      'invoice_tax_rate'
    )
    check(
      'gathered invoice inherits tax snapshot from linked quote',
      gatherInvoiceTaxName?.valueText === 'MI1 Gather Tax' &&
        gatherInvoiceTaxRate?.valueNumber === 8.25,
      { name: gatherInvoiceTaxName?.valueText, rate: gatherInvoiceTaxRate?.valueNumber }
    )

    // Quoteless WO — default tax rate fallback (documents.taxRates isDefault entry).
    originalTaxRates = await getOrganizationSetting({ organizationId, key: 'documents.taxRates' })
    await updateOrganizationSetting({
      organizationId,
      key: 'documents.taxRates',
      value: [{ id: 'mi1-verify-rate', name: 'MI1 Verify Default', rate: 6, isDefault: true }],
    })
    await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })
    taxRatesChanged = true

    const woNoQuote = await handler.create('work_order', {
      work_order_title: '[MI1-verify] Quoteless WO',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(woNoQuote.instance.id)
    const lineNoQuote = await handler.create('line_item', {
      line_item_name: '[MI1-verify] Quoteless WO line',
      line_item_qty: 1,
      line_item_unit_price: 1000,
      line_item_taxable: true,
      line_item_sort_order: 0,
      line_item_work_order: toRecordId('work_order', woNoQuote.instance.id),
    })
    createdLineIds.push(lineNoQuote.instance.id)

    const noQuoteResult = await createInvoiceFromWorkOrder({
      organizationId,
      userId,
      workOrderInstanceId: woNoQuote.instance.id,
      lineInstanceIds: [lineNoQuote.instance.id],
    })
    createdInvoiceIds.push(noQuoteResult.instanceId)
    const noQuoteTaxName = await fieldValueByAttr(
      organizationId,
      'invoice',
      noQuoteResult.instanceId,
      'invoice_tax_name'
    )
    const noQuoteTaxRate = await fieldValueByAttr(
      organizationId,
      'invoice',
      noQuoteResult.instanceId,
      'invoice_tax_rate'
    )
    const noQuoteDiscountType = await fieldValueByAttr(
      organizationId,
      'invoice',
      noQuoteResult.instanceId,
      'invoice_discount_type'
    )
    check(
      'quoteless WO gather falls back to documents.taxRates isDefault entry',
      noQuoteTaxName?.valueText === 'MI1 Verify Default' &&
        noQuoteTaxRate?.valueNumber === 6 &&
        !noQuoteDiscountType?.optionId,
      {
        name: noQuoteTaxName?.valueText,
        rate: noQuoteTaxRate?.valueNumber,
        discountType: noQuoteDiscountType?.optionId,
      }
    )

    // WO without a contact — BadRequestError.
    const woNoContact = await handler.create('work_order', {
      work_order_title: '[MI1-verify] No-contact WO',
    })
    createdWorkOrderIds.push(woNoContact.instance.id)
    const noContactErr = await expectThrow(() =>
      createInvoiceFromWorkOrder({
        organizationId,
        userId,
        workOrderInstanceId: woNoContact.instance.id,
        lineInstanceIds: [],
      })
    )
    check(
      'WO without contact -> BadRequestError',
      noContactErr instanceof AuxxError && /contact/i.test((noContactErr as Error).message)
    )

    // ── 5: Unstamp + void/delete lifecycle (§L.6) ───────────────────────────
    console.log('5: unstamp + void/delete lifecycle')

    // deleteInvoiceLine on a gather copy — its source becomes uninvoiced again.
    // Find the copy whose sourceLineId points at lineJob1.
    let copyOfJob1Id: string | undefined
    for (const copyId of ownedCopies.ids) {
      const sourceLineIdFv = await fieldValueByAttr(
        organizationId,
        'line_item',
        copyId,
        'line_item_source_line_id'
      )
      if (sourceLineIdFv?.valueText === lineJob1.instance.id) {
        copyOfJob1Id = copyId
        break
      }
    }
    if (!copyOfJob1Id) throw new Error('Could not locate the gather copy of lineJob1')

    await deleteInvoiceLine({ organizationId, userId, lineInstanceId: copyOfJob1Id })
    createdLineIds.splice(createdLineIds.indexOf(copyOfJob1Id), 1)

    const uninvoiced3 = await listUninvoicedLines({
      organizationId,
      userId,
      workOrderInstanceId: woGather.instance.id,
    })
    check(
      'deleteInvoiceLine frees the source — now 2 uninvoiced (lineJob1 + lineVisit2)',
      uninvoiced3.length === 2 &&
        uninvoiced3.some((l) => l.instanceId === lineJob1.instance.id) &&
        uninvoiced3.some((l) => l.instanceId === lineVisit2.instance.id),
      uninvoiced3.map((l) => l.instanceId)
    )

    // voidInvoice — all remaining sources freed, copies remain, status void.
    await voidInvoice({ organizationId, userId, invoiceInstanceId: gatherResult.instanceId })
    const gatherStatusAfterVoid = await fieldValueByAttr(
      organizationId,
      'invoice',
      gatherResult.instanceId,
      'invoice_status'
    )
    check(
      "voidInvoice -> status 'void'",
      gatherStatusAfterVoid?.optionId === 'void',
      gatherStatusAfterVoid?.optionId
    )

    const lineJob2InvoiceAfterVoid = await fieldValueByAttr(
      organizationId,
      'line_item',
      lineJob2.instance.id,
      'line_item_invoice'
    )
    const lineVisit1InvoiceAfterVoid = await fieldValueByAttr(
      organizationId,
      'line_item',
      lineVisit1.instance.id,
      'line_item_invoice'
    )
    check(
      'voidInvoice frees ALL remaining sources',
      !lineJob2InvoiceAfterVoid?.relatedEntityId && !lineVisit1InvoiceAfterVoid?.relatedEntityId
    )

    const remainingCopyIds = ownedCopies.ids.filter((id) => id !== copyOfJob1Id)
    let copiesStillExist = true
    for (const id of remainingCopyIds) {
      if (!(await instanceExists(id))) copiesStillExist = false
    }
    check('voidInvoice leaves the invoice copies in place (readable history)', copiesStillExist)

    // Void with a recorded payment — rejected.
    const voidPaidInvoice = await handler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(voidPaidInvoice.instance.id)
    const voidPaidLine = await handler.create('line_item', {
      line_item_name: '[MI1-verify] Void-with-payment line',
      line_item_qty: 1,
      line_item_unit_price: 5000,
      line_item_taxable: false,
      line_item_invoice: toRecordId('invoice', voidPaidInvoice.instance.id),
    })
    createdLineIds.push(voidPaidLine.instance.id)
    const voidPaidTx = await recordManualPayment({
      organizationId,
      userId,
      invoiceInstanceId: voidPaidInvoice.instance.id,
      amount: 5000,
      date: today,
      method: 'cash',
    })
    const voidWithPaymentErr = await expectThrow(() =>
      voidInvoice({ organizationId, userId, invoiceInstanceId: voidPaidInvoice.instance.id })
    )
    check(
      'voidInvoice with a recorded payment rejected',
      voidWithPaymentErr instanceof AuxxError &&
        /Remove recorded payments/.test((voidWithPaymentErr as Error).message)
    )
    await deleteManualPayment({ organizationId, userId, transactionId: voidPaidTx.transactionId })

    // deleteInvoice (no payments) — sources freed, copies hard-deleted, instance gone.
    const noQuoteOwnedCopies = await handler.listFiltered({
      entityDefinitionId: 'line_item',
      filters: [
        {
          id: 'noquote-owned-lines',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'c1',
              fieldId: 'line_item:invoice',
              operator: 'is',
              value: noQuoteResult.recordId,
            },
            { id: 'c2', fieldId: 'line_item:workOrder', operator: 'empty', value: null },
          ],
        },
      ],
      limit: 10,
      mode: 'oneshot',
    })
    check(
      'quoteless invoice has exactly 1 owned copy before delete',
      noQuoteOwnedCopies.ids.length === 1,
      noQuoteOwnedCopies.ids.length
    )
    const noQuoteCopyId = noQuoteOwnedCopies.ids[0]!

    await deleteInvoice({ organizationId, userId, invoiceInstanceId: noQuoteResult.instanceId })
    createdInvoiceIds.splice(createdInvoiceIds.indexOf(noQuoteResult.instanceId), 1)
    createdLineIds.splice(createdLineIds.indexOf(noQuoteCopyId), 1)

    const lineNoQuoteInvoiceAfterDelete = await fieldValueByAttr(
      organizationId,
      'line_item',
      lineNoQuote.instance.id,
      'line_item_invoice'
    )
    check('deleteInvoice frees the source line', !lineNoQuoteInvoiceAfterDelete?.relatedEntityId)
    check('deleteInvoice hard-deletes the owned copy', !(await instanceExists(noQuoteCopyId)))
    check(
      'deleteInvoice removes the invoice instance',
      !(await instanceExists(noQuoteResult.instanceId))
    )

    // FK restrict: raw EntityInstance delete on an invoice with a ledger row is blocked.
    const fkInvoice = await handler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(fkInvoice.instance.id)
    const fkLine = await handler.create('line_item', {
      line_item_name: '[MI1-verify] FK-restrict line',
      line_item_qty: 1,
      line_item_unit_price: 2000,
      line_item_taxable: false,
      line_item_invoice: toRecordId('invoice', fkInvoice.instance.id),
    })
    createdLineIds.push(fkLine.instance.id)
    const fkTx = await recordManualPayment({
      organizationId,
      userId,
      invoiceInstanceId: fkInvoice.instance.id,
      amount: 2000,
      date: today,
      method: 'cash',
    })

    const rawDeleteErr = await expectThrow(async () => {
      await database.$client.query('DELETE FROM "EntityInstance" WHERE id = $1', [
        fkInvoice.instance.id,
      ])
    })
    check('raw EntityInstance delete blocked by PaymentTransaction FK restrict', !!rawDeleteErr)

    // Clean up properly: ledger row first, then delete the invoice through the real path.
    await deleteManualPayment({ organizationId, userId, transactionId: fkTx.transactionId })
    await deleteInvoice({ organizationId, userId, invoiceInstanceId: fkInvoice.instance.id })
    createdInvoiceIds.splice(createdInvoiceIds.indexOf(fkInvoice.instance.id), 1)
    createdLineIds.splice(createdLineIds.indexOf(fkLine.instance.id), 1)
    check(
      'invoice deletable after removing the ledger row first',
      !(await instanceExists(fkInvoice.instance.id))
    )
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────
    console.log(
      `Cleanup: ${createdTransactionIds.length} ledger rows, ${createdLineIds.length} lines, ` +
        `${createdInvoiceIds.length} invoices, ${createdWorkOrderIds.length} work orders, ` +
        `${createdQuoteIds.length} quotes`
    )
    for (const transactionId of [...new Set(createdTransactionIds)]) {
      try {
        const row = await database.query.PaymentTransaction.findFirst({
          where: (t, { eq }) => eq(t.id, transactionId),
        })
        if (!row) continue
        if (row.paymentInstanceId) {
          try {
            await handler.delete(toRecordId('payment', row.paymentInstanceId))
          } catch {
            // best-effort — the row delete below is the important part
          }
        }
        await database.$client.query('DELETE FROM "PaymentTransaction" WHERE id = $1', [
          transactionId,
        ])
      } catch (err) {
        console.log(
          `  cleanup failed for PaymentTransaction:${transactionId}:`,
          err instanceof Error ? err.message : err
        )
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
    for (const id of [...new Set(createdInvoiceIds)]) {
      try {
        await handler.delete(toRecordId('invoice', id))
      } catch (err) {
        console.log(`  cleanup failed for invoice:${id}:`, err instanceof Error ? err.message : err)
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
    if (taxRatesChanged) {
      try {
        await updateOrganizationSetting({
          organizationId,
          key: 'documents.taxRates',
          value: originalTaxRates as never,
        })
        await onCacheEvent('org.settings.changed', {
          orgId: organizationId,
          broadcastUserKeys: true,
        })
      } catch (err) {
        console.log(
          '  cleanup failed restoring documents.taxRates:',
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
