// apps/worker/scripts/verify-money-deposit-allocations.ts
/**
 * Money 16 (deposit accounting / `PaymentAllocation`) integration verification
 * (plans/dispatch/money/16-deposit-accounting.md §G). Exercises the real write paths —
 * `createVisitInvoice` (billing-commands.ts), `applyHeldDepositsToInvoice`/`syncTransaction`
 * (ledger.ts), `recordManualPayment`/`deleteManualPayment`, `hasSucceededCharges`/
 * `guardInvoiceDelete` — plus the deposit-visibility reads (`getWorkOrderBillingState`/
 * `getContactBillingOverview`).
 *
 * SAFETY: the dev `.env` is LIVE email. `markChargeSucceeded`/`applyStripeEvent` are NEVER
 * called here — succeeded charge/refund ledger rows are seeded by direct
 * `database.insert(schema.PaymentTransaction)` (the `verify-money-payment-receipt.ts`
 * precedent), then driven through the real `syncTransaction`/`createVisitInvoice`/
 * `recordManualPayment`/`deleteManualPayment` machinery. `refundTransaction` itself is never
 * called either (it makes a real Stripe API call) — the refund scenarios hand-insert the
 * refund row and copy allocations the exact way `stripe-rail.ts`'s `refundTransaction` does
 * (§C.5), then call `syncInvoicePaymentState` directly, the documented seam for this test.
 *
 * Creates records prefixed "[DA-verify]" and deletes/reverts everything in a try/finally.
 * Cleanup order matters (mi1/delete-safety precedent): ledger rows (raw-deleted, bypassing the
 * succeeded-charge guard entirely) BEFORE invoices (their own succeeded-charge guard would
 * otherwise permanently block them) BEFORE line items (`InvoiceLineAllocation.sourceLineItemId`
 * is a restrict FK, freed only once the owning invoice cascades its allocation rows away)
 * BEFORE work orders BEFORE quotes BEFORE contacts.
 *
 * Run (from repo root) under the worker runtime:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/verify-money-deposit-allocations.ts
 */

import { database, schema } from '@auxx/database'
import { setVisitStatus } from '@auxx/lib/dispatch'
import { AuxxError } from '@auxx/lib/errors'
import {
  createVisitInvoice,
  deleteInvoice,
  deleteManualPayment,
  getContactBillingOverview,
  getInvoiceDepositApplied,
  getWorkOrderBillingState,
  hasSucceededCharges,
  recordManualPayment,
  syncInvoicePaymentState,
  voidInvoice,
} from '@auxx/lib/money'
import { UnifiedCrudHandler } from '@auxx/lib/resources'

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

/** All `PaymentAllocation` rows for one transaction. */
async function allocationsForTransaction(transactionId: string) {
  return database.query.PaymentAllocation.findMany({
    where: (t, { eq }) => eq(t.paymentTransactionId, transactionId),
  })
}

/** All `PaymentAllocation` rows for one invoice. */
async function allocationsForInvoice(invoiceInstanceId: string) {
  return database.query.PaymentAllocation.findMany({
    where: (t, { eq }) => eq(t.invoiceInstanceId, invoiceInstanceId),
  })
}

/** Insert a succeeded Stripe `charge` ledger row directly (bypasses the Stripe rail entirely —
 * the `verify-money-payment-receipt.ts` precedent). */
async function insertSucceededCharge(input: {
  organizationId: string
  amount: number
  quoteInstanceId?: string
  workOrderInstanceId?: string
  invoiceInstanceId?: string
  contactInstanceId?: string
}) {
  const [row] = await database
    .insert(schema.PaymentTransaction)
    .values({
      organizationId: input.organizationId,
      provider: 'stripe',
      kind: 'charge',
      status: 'succeeded',
      amount: input.amount,
      currency: 'USD',
      method: 'card',
      quoteInstanceId: input.quoteInstanceId ?? null,
      workOrderInstanceId: input.workOrderInstanceId ?? null,
      invoiceInstanceId: input.invoiceInstanceId ?? null,
      contactInstanceId: input.contactInstanceId ?? null,
      updatedAt: new Date(),
    })
    .returning()
  return row!
}

/**
 * Hand-insert a `succeeded` refund row copying a charge's allocations — the exact
 * `refundTransaction` (stripe-rail.ts §C.5) copy-block, minus the real Stripe API call and the
 * pending->succeeded webhook hop (never exercised here, per the script's safety note). Returns
 * the refund row and however many allocations it copied (0 for a still-held deposit).
 */
async function refundChargeByCopyingAllocations(input: {
  organizationId: string
  userId: string
  charge: {
    id: string
    amount: number
    currency: string
    quoteInstanceId: string | null
    workOrderInstanceId: string | null
    contactInstanceId: string | null
  }
}) {
  const { organizationId, userId, charge } = input
  const [refundRow] = await database
    .insert(schema.PaymentTransaction)
    .values({
      organizationId,
      provider: 'stripe',
      kind: 'refund',
      status: 'succeeded',
      amount: charge.amount,
      currency: charge.currency,
      quoteInstanceId: charge.quoteInstanceId,
      workOrderInstanceId: charge.workOrderInstanceId,
      contactInstanceId: charge.contactInstanceId,
      refundedTransactionId: charge.id,
      createdByUserId: userId,
      updatedAt: new Date(),
    })
    .returning()

  const chargeAllocations = await allocationsForTransaction(charge.id)
  if (chargeAllocations.length > 0) {
    await database.insert(schema.PaymentAllocation).values(
      chargeAllocations.map((allocation) => ({
        organizationId,
        paymentTransactionId: refundRow!.id,
        invoiceInstanceId: allocation.invoiceInstanceId,
        amount: allocation.amount,
        createdByUserId: userId,
      }))
    )
    for (const invoiceInstanceId of new Set(chargeAllocations.map((a) => a.invoiceInstanceId))) {
      await syncInvoicePaymentState({ organizationId, userId, invoiceInstanceId })
    }
  }
  return { refund: refundRow!, copiedAllocationCount: chargeAllocations.length }
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — same as MI1/MI2 scripts)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const today = new Date().toISOString().split('T')[0]!

  const createdContactIds: string[] = []
  const createdQuoteIds: string[] = []
  const createdWorkOrderIds: string[] = []
  const createdLineIds: string[] = []
  const createdInvoiceIds: string[] = []
  const createdTransactionIds: string[] = []

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. Partial application (THE bug fix) + deposit-visibility read-side
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: partial application (THE bug) + read-side')

    const contactA = await handler.create('contact', {
      first_name: '[DA-verify]',
      last_name: 'Partial application',
      primary_email: 'da-verify-a@example.com',
    })
    createdContactIds.push(contactA.instance.id)
    const contactARecordId = toRecordId('contact', contactA.instance.id)

    const quoteA = await handler.create('quote', {
      quote_title: '[DA-verify] Partial application quote',
      quote_contact: contactARecordId,
    })
    createdQuoteIds.push(quoteA.instance.id)

    const woA = await handler.create('work_order', {
      work_order_title: '[DA-verify] Partial application WO (per-visit, default basis)',
      work_order_contact: contactARecordId,
      work_order_quote: toRecordId('quote', quoteA.instance.id),
      // 'as_needed' — the default 'per_visit_completed' timing auto-generates a draft the
      // instant `setVisitStatus` lands a visit on 'done' (`maybeGenerateVisitInvoiceDraft`,
      // auto-invoice.ts:292 — unconditional on `status === 'done'`, NOT gated by
      // `suppressRollUp`, which only gates the separate `on_completion` door). This script
      // wants exclusively manual `createVisitInvoice` calls, so opt out of auto-drafting.
      work_order_invoice_timing: 'as_needed',
    })
    createdWorkOrderIds.push(woA.instance.id)

    const woAVisits = await database.query.WorkOrderVisit.findMany({
      where: (t, { eq }) => eq(t.workOrderId, woA.instance.id),
    })
    check(
      'setup: work_order create auto-materializes exactly 1 visit',
      woAVisits.length === 1,
      woAVisits.length
    )
    const visit1 = woAVisits[0]!
    const [visit2] = await database
      .insert(schema.WorkOrderVisit)
      .values({ organizationId, workOrderId: woA.instance.id })
      .returning()

    const line1 = await handler.create('line_item', {
      line_item_name: '[DA-verify] Visit 1 charge ($150)',
      line_item_qty: 1,
      line_item_unit_price: 15000,
      line_item_taxable: false,
      line_item_work_order: woA.recordId,
      line_item_visit_id: visit1.id,
    })
    createdLineIds.push(line1.instance.id)
    const line2 = await handler.create('line_item', {
      line_item_name: '[DA-verify] Visit 2 charge ($150)',
      line_item_qty: 1,
      line_item_unit_price: 15000,
      line_item_taxable: false,
      line_item_work_order: woA.recordId,
      line_item_visit_id: visit2!.id,
    })
    createdLineIds.push(line2.instance.id)

    // suppressRollUp — never let a real per_visit/on_completion trigger auto-draft an invoice
    // out from under this test; every invoice here is created by an explicit `createVisitInvoice`
    // call so the totals stay exactly under this script's control.
    await setVisitStatus({
      organizationId,
      userId,
      visitId: visit1.id,
      status: 'done',
      suppressRollUp: true,
    })
    await setVisitStatus({
      organizationId,
      userId,
      visitId: visit2!.id,
      status: 'done',
      suppressRollUp: true,
    })

    const depositA = await insertSucceededCharge({
      organizationId,
      amount: 20000, // $200 deposit
      quoteInstanceId: quoteA.instance.id,
      workOrderInstanceId: woA.instance.id,
      contactInstanceId: contactA.instance.id,
    })
    createdTransactionIds.push(depositA.id)

    // ── Read-side, stage 0: deposit fully held, nothing applied yet ─────────
    const stage0State = await getWorkOrderBillingState({
      organizationId,
      userId,
      workOrderInstanceId: woA.instance.id,
    })
    check(
      'stage0: depositHeld=20000, depositApplied=0 before any invoice',
      stage0State.summary.depositHeld === 20000 && stage0State.summary.depositApplied === 0,
      stage0State.summary
    )
    const stage0Overview = await getContactBillingOverview({
      organizationId,
      userId,
      contactInstanceId: contactA.instance.id,
    })
    check(
      'stage0: creditOnAccount=20000',
      stage0Overview.creditOnAccount === 20000,
      stage0Overview.creditOnAccount
    )

    // ── Invoice #1 ($150) — deposit partially applies, remainder stays held ─
    const invoice1 = await createVisitInvoice({
      organizationId,
      userId,
      workOrderInstanceId: woA.instance.id,
      visitIds: [visit1.id],
    })
    createdInvoiceIds.push(invoice1.instanceId)

    const invoice1Total = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoice1.instanceId,
      'invoice_total'
    )
    check(
      'invoice1 total = 15000',
      invoice1Total?.valueNumber === 15000,
      invoice1Total?.valueNumber
    )

    const invoice1Allocations = await allocationsForInvoice(invoice1.instanceId)
    check(
      'invoice1 has exactly ONE allocation of 15000 against the deposit',
      invoice1Allocations.length === 1 &&
        invoice1Allocations[0]?.amount === 15000 &&
        invoice1Allocations[0]?.paymentTransactionId === depositA.id,
      invoice1Allocations
    )

    const invoice1AmountPaid = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoice1.instanceId,
      'invoice_amount_paid'
    )
    const invoice1Balance = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoice1.instanceId,
      'invoice_balance'
    )
    const invoice1Status = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoice1.instanceId,
      'invoice_status'
    )
    check(
      'invoice1 amount_paid=150.00, balance=0 (NOT -50), status=paid',
      invoice1AmountPaid?.valueNumber === 15000 &&
        invoice1Balance?.valueNumber === 0 &&
        invoice1Status?.optionId === 'paid',
      {
        amountPaid: invoice1AmountPaid?.valueNumber,
        balance: invoice1Balance?.valueNumber,
        status: invoice1Status?.optionId,
      }
    )

    const depositAAllocationsAfterInv1 = await allocationsForTransaction(depositA.id)
    const depositAAllocatedAfterInv1 = depositAAllocationsAfterInv1.reduce(
      (sum, a) => sum + a.amount,
      0
    )
    check(
      'deposit remainder after invoice1 = 50.00 held ($200 - $150)',
      depositAAllocatedAfterInv1 === 15000,
      depositAAllocatedAfterInv1
    )

    const invoice1MirrorId = invoice1Allocations[0]?.paymentInstanceId
    check('invoice1 allocation stamped a payment mirror', !!invoice1MirrorId)
    const invoice1MirrorAmount = invoice1MirrorId
      ? await fieldValueByAttr(organizationId, 'payment', invoice1MirrorId, 'payment_amount')
      : null
    check(
      'invoice1 mirror payment_amount = 15000 (the allocation amount, not the deposit total)',
      invoice1MirrorAmount?.valueNumber === 15000,
      invoice1MirrorAmount?.valueNumber
    )

    // ── Read-side, stage 1: $50 still held, $150 applied ─────────────────────
    const stage1State = await getWorkOrderBillingState({
      organizationId,
      userId,
      workOrderInstanceId: woA.instance.id,
    })
    check(
      'stage1: depositHeld=5000, depositApplied=15000',
      stage1State.summary.depositHeld === 5000 && stage1State.summary.depositApplied === 15000,
      stage1State.summary
    )
    const stage1Overview = await getContactBillingOverview({
      organizationId,
      userId,
      contactInstanceId: contactA.instance.id,
    })
    check(
      'stage1: creditOnAccount=5000',
      stage1Overview.creditOnAccount === 5000,
      stage1Overview.creditOnAccount
    )

    // ── Invoice #2 ($150) — deposit's $50 remainder applies, invoice partial ─
    const invoice2 = await createVisitInvoice({
      organizationId,
      userId,
      workOrderInstanceId: woA.instance.id,
      visitIds: [visit2!.id],
    })
    createdInvoiceIds.push(invoice2.instanceId)

    const invoice2Allocations = await allocationsForInvoice(invoice2.instanceId)
    check(
      'invoice2 has exactly ONE allocation of 5000 (the deposit remainder)',
      invoice2Allocations.length === 1 &&
        invoice2Allocations[0]?.amount === 5000 &&
        invoice2Allocations[0]?.paymentTransactionId === depositA.id,
      invoice2Allocations
    )

    const invoice2AmountPaid = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoice2.instanceId,
      'invoice_amount_paid'
    )
    const invoice2Balance = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoice2.instanceId,
      'invoice_balance'
    )
    const invoice2Status = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoice2.instanceId,
      'invoice_status'
    )
    check(
      'invoice2 amount_paid=50.00, balance=100.00, status=partially_paid',
      invoice2AmountPaid?.valueNumber === 5000 &&
        invoice2Balance?.valueNumber === 10000 &&
        invoice2Status?.optionId === 'partially_paid',
      {
        amountPaid: invoice2AmountPaid?.valueNumber,
        balance: invoice2Balance?.valueNumber,
        status: invoice2Status?.optionId,
      }
    )

    const depositAAllocationsFinal = await allocationsForTransaction(depositA.id)
    const depositAAllocatedFinal = depositAAllocationsFinal.reduce((sum, a) => sum + a.amount, 0)
    check(
      'deposit fully drained (150 + 50 = 200)',
      depositAAllocatedFinal === 20000,
      depositAAllocatedFinal
    )

    // ── Read-side, stage 2: deposit fully drained ────────────────────────────
    const stage2State = await getWorkOrderBillingState({
      organizationId,
      userId,
      workOrderInstanceId: woA.instance.id,
    })
    check(
      'stage2: depositHeld=0, depositApplied=20000',
      stage2State.summary.depositHeld === 0 && stage2State.summary.depositApplied === 20000,
      stage2State.summary
    )
    const stage2Overview = await getContactBillingOverview({
      organizationId,
      userId,
      contactInstanceId: contactA.instance.id,
    })
    check(
      'stage2: creditOnAccount=0',
      stage2Overview.creditOnAccount === 0,
      stage2Overview.creditOnAccount
    )

    // ══════════════════════════════════════════════════════════════════════
    // 2. Deposit <= first invoice (MP2's original scenario, now via allocations)
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: deposit <= first invoice')

    const contactB = await handler.create('contact', {
      first_name: '[DA-verify]',
      last_name: 'Small deposit',
      primary_email: 'da-verify-b@example.com',
    })
    createdContactIds.push(contactB.instance.id)
    const contactBRecordId = toRecordId('contact', contactB.instance.id)

    const quoteB = await handler.create('quote', {
      quote_title: '[DA-verify] Small deposit quote',
      quote_contact: contactBRecordId,
    })
    createdQuoteIds.push(quoteB.instance.id)

    const woB = await handler.create('work_order', {
      work_order_title: '[DA-verify] Small deposit WO',
      work_order_contact: contactBRecordId,
      work_order_quote: toRecordId('quote', quoteB.instance.id),
      work_order_invoice_timing: 'as_needed', // see woA's note — opt out of auto-drafting
    })
    createdWorkOrderIds.push(woB.instance.id)
    const woBVisits = await database.query.WorkOrderVisit.findMany({
      where: (t, { eq }) => eq(t.workOrderId, woB.instance.id),
    })
    const visitB = woBVisits[0]!

    const lineB = await handler.create('line_item', {
      line_item_name: '[DA-verify] WO-B visit charge ($300)',
      line_item_qty: 1,
      line_item_unit_price: 30000,
      line_item_taxable: false,
      line_item_work_order: woB.recordId,
      line_item_visit_id: visitB.id,
    })
    createdLineIds.push(lineB.instance.id)

    await setVisitStatus({
      organizationId,
      userId,
      visitId: visitB.id,
      status: 'done',
      suppressRollUp: true,
    })

    const depositB = await insertSucceededCharge({
      organizationId,
      amount: 10000, // $100 deposit, less than the $300 invoice
      quoteInstanceId: quoteB.instance.id,
      workOrderInstanceId: woB.instance.id,
      contactInstanceId: contactB.instance.id,
    })
    createdTransactionIds.push(depositB.id)

    const invoiceB = await createVisitInvoice({
      organizationId,
      userId,
      workOrderInstanceId: woB.instance.id,
      visitIds: [visitB.id],
    })
    createdInvoiceIds.push(invoiceB.instanceId)

    const invoiceBAllocations = await allocationsForInvoice(invoiceB.instanceId)
    check(
      'invoiceB: single allocation for the full $100 deposit (deposit <= invoice)',
      invoiceBAllocations.length === 1 &&
        invoiceBAllocations[0]?.amount === 10000 &&
        invoiceBAllocations[0]?.paymentTransactionId === depositB.id,
      invoiceBAllocations
    )
    const depositBAllocated = (await allocationsForTransaction(depositB.id)).reduce(
      (sum, a) => sum + a.amount,
      0
    )
    check('depositB fully allocated, 0 remainder', depositBAllocated === 10000, depositBAllocated)

    const invoiceBMirrorId = invoiceBAllocations[0]?.paymentInstanceId
    check('invoiceB allocation stamped a payment mirror', !!invoiceBMirrorId)
    const invoiceBMirrorAmount = invoiceBMirrorId
      ? await fieldValueByAttr(organizationId, 'payment', invoiceBMirrorId, 'payment_amount')
      : null
    check(
      'invoiceB mirror payment_amount = 10000',
      invoiceBMirrorAmount?.valueNumber === 10000,
      invoiceBMirrorAmount?.valueNumber
    )
    const invoiceBAmountPaid = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoiceB.instanceId,
      'invoice_amount_paid'
    )
    check(
      'invoiceB invoice_amount_paid = 10000',
      invoiceBAmountPaid?.valueNumber === 10000,
      invoiceBAmountPaid?.valueNumber
    )

    // ══════════════════════════════════════════════════════════════════════
    // 3. Manual payment regression (recordManualPayment / deleteManualPayment)
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: manual payment regression')

    const contactC = await handler.create('contact', {
      first_name: '[DA-verify]',
      last_name: 'Manual payment',
      primary_email: 'da-verify-c@example.com',
    })
    createdContactIds.push(contactC.instance.id)
    const contactCRecordId = toRecordId('contact', contactC.instance.id)

    const invoiceC = await handler.create('invoice', { invoice_contact: contactCRecordId })
    createdInvoiceIds.push(invoiceC.instance.id)
    const lineC = await handler.create('line_item', {
      line_item_name: '[DA-verify] Manual-payment invoice line ($200)',
      line_item_qty: 1,
      line_item_unit_price: 20000,
      line_item_taxable: false,
      line_item_invoice: toRecordId('invoice', invoiceC.instance.id),
    })
    createdLineIds.push(lineC.instance.id)

    const manualPay = await recordManualPayment({
      organizationId,
      userId,
      invoiceInstanceId: invoiceC.instance.id,
      amount: 20000,
      date: today,
      method: 'cash',
    })
    createdTransactionIds.push(manualPay.transactionId)

    const manualAllocations = await allocationsForTransaction(manualPay.transactionId)
    check(
      'recordManualPayment inserted ONE full-amount allocation at record time',
      manualAllocations.length === 1 &&
        manualAllocations[0]?.amount === 20000 &&
        manualAllocations[0]?.invoiceInstanceId === invoiceC.instance.id,
      manualAllocations
    )
    const manualMirrorId = manualAllocations[0]?.paymentInstanceId
    check('manual-payment allocation stamped a payment mirror', !!manualMirrorId)
    const manualMirrorAmount = manualMirrorId
      ? await fieldValueByAttr(organizationId, 'payment', manualMirrorId, 'payment_amount')
      : null
    check(
      'manual-payment mirror payment_amount = 20000',
      manualMirrorAmount?.valueNumber === 20000,
      manualMirrorAmount?.valueNumber
    )
    const invoiceCStatusAfterPay = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoiceC.instance.id,
      'invoice_status'
    )
    check(
      'invoiceC status = paid after manual payment',
      invoiceCStatusAfterPay?.optionId === 'paid',
      invoiceCStatusAfterPay?.optionId
    )

    await deleteManualPayment({ organizationId, userId, transactionId: manualPay.transactionId })
    check(
      'deleteManualPayment removed the mirror entity',
      manualMirrorId ? !(await instanceExists(manualMirrorId)) : false
    )
    const manualAllocationsAfterDelete = await allocationsForTransaction(manualPay.transactionId)
    check(
      'deleteManualPayment removed the allocation row(s) (cascade)',
      manualAllocationsAfterDelete.length === 0,
      manualAllocationsAfterDelete.length
    )
    const manualTxAfterDelete = await database.query.PaymentTransaction.findFirst({
      where: (t, { eq }) => eq(t.id, manualPay.transactionId),
    })
    check('deleteManualPayment removed the transaction row', !manualTxAfterDelete)
    const invoiceCAmountPaidAfterDelete = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoiceC.instance.id,
      'invoice_amount_paid'
    )
    const invoiceCStatusAfterDelete = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoiceC.instance.id,
      'invoice_status'
    )
    check(
      'deleteManualPayment resynced invoiceC: amount_paid=0, status=sent',
      invoiceCAmountPaidAfterDelete?.valueNumber === 0 &&
        invoiceCStatusAfterDelete?.optionId === 'sent',
      {
        amountPaid: invoiceCAmountPaidAfterDelete?.valueNumber,
        status: invoiceCStatusAfterDelete?.optionId,
      }
    )

    // ══════════════════════════════════════════════════════════════════════
    // 4. Refund applied deposit (hand-inserted refund + allocation-copy machinery)
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: refund applied deposit')

    const { refund: refundA, copiedAllocationCount: refundACopyCount } =
      await refundChargeByCopyingAllocations({
        organizationId,
        userId,
        charge: {
          id: depositA.id,
          amount: depositA.amount,
          currency: depositA.currency,
          quoteInstanceId: depositA.quoteInstanceId,
          workOrderInstanceId: depositA.workOrderInstanceId,
          contactInstanceId: depositA.contactInstanceId,
        },
      })
    createdTransactionIds.push(refundA.id)
    check(
      'refund of a fully-applied deposit copies BOTH allocations (150 + 50)',
      refundACopyCount === 2,
      refundACopyCount
    )

    const invoice1StatusAfterRefund = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoice1.instanceId,
      'invoice_status'
    )
    const invoice1AmountPaidAfterRefund = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoice1.instanceId,
      'invoice_amount_paid'
    )
    check(
      'invoice1 reprojects paid -> sent after the refund, amount_paid back to 0',
      invoice1StatusAfterRefund?.optionId === 'sent' &&
        invoice1AmountPaidAfterRefund?.valueNumber === 0,
      {
        status: invoice1StatusAfterRefund?.optionId,
        amountPaid: invoice1AmountPaidAfterRefund?.valueNumber,
      }
    )
    const invoice2StatusAfterRefund = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoice2.instanceId,
      'invoice_status'
    )
    const invoice2AmountPaidAfterRefund = await fieldValueByAttr(
      organizationId,
      'invoice',
      invoice2.instanceId,
      'invoice_amount_paid'
    )
    check(
      'invoice2 reprojects partially_paid -> sent after the refund, amount_paid back to 0',
      invoice2StatusAfterRefund?.optionId === 'sent' &&
        invoice2AmountPaidAfterRefund?.valueNumber === 0,
      {
        status: invoice2StatusAfterRefund?.optionId,
        amountPaid: invoice2AmountPaidAfterRefund?.valueNumber,
      }
    )

    const invoice1DepositApplied = await getInvoiceDepositApplied(
      organizationId,
      invoice1.instanceId
    )
    const invoice2DepositApplied = await getInvoiceDepositApplied(
      organizationId,
      invoice2.instanceId
    )
    check(
      'per-invoice "Deposit applied" figure nets to zero on both invoices after the refund',
      invoice1DepositApplied === 0 && invoice2DepositApplied === 0,
      { invoice1DepositApplied, invoice2DepositApplied }
    )

    // ── Refund of a HELD (never-applied) deposit — copies nothing, touches no invoice ──
    console.log('4b: refund of a held deposit (no invoice touch)')

    const contactD = await handler.create('contact', {
      first_name: '[DA-verify]',
      last_name: 'Held deposit refund',
      primary_email: 'da-verify-d@example.com',
    })
    createdContactIds.push(contactD.instance.id)
    const contactDRecordId = toRecordId('contact', contactD.instance.id)
    const quoteD = await handler.create('quote', {
      quote_title: '[DA-verify] Held-deposit-refund quote',
      quote_contact: contactDRecordId,
    })
    createdQuoteIds.push(quoteD.instance.id)
    const woD = await handler.create('work_order', {
      work_order_title: '[DA-verify] Held-deposit-refund WO (no invoice ever created)',
      work_order_contact: contactDRecordId,
      work_order_quote: toRecordId('quote', quoteD.instance.id),
    })
    createdWorkOrderIds.push(woD.instance.id)

    const depositD = await insertSucceededCharge({
      organizationId,
      amount: 5000,
      quoteInstanceId: quoteD.instance.id,
      workOrderInstanceId: woD.instance.id,
      contactInstanceId: contactD.instance.id,
    })
    createdTransactionIds.push(depositD.id)

    const { refund: refundD, copiedAllocationCount: refundDCopyCount } =
      await refundChargeByCopyingAllocations({
        organizationId,
        userId,
        charge: {
          id: depositD.id,
          amount: depositD.amount,
          currency: depositD.currency,
          quoteInstanceId: depositD.quoteInstanceId,
          workOrderInstanceId: depositD.workOrderInstanceId,
          contactInstanceId: depositD.contactInstanceId,
        },
      })
    createdTransactionIds.push(refundD.id)
    check(
      'refund of a held (never-applied) deposit copies zero allocations',
      refundDCopyCount === 0,
      refundDCopyCount
    )
    const refundDAllocations = await allocationsForTransaction(refundD.id)
    check('refund row itself has no allocation rows', refundDAllocations.length === 0)

    // ══════════════════════════════════════════════════════════════════════
    // 5. Guards — hasSucceededCharges / void / delete / pre-delete-hook purge
    // ══════════════════════════════════════════════════════════════════════
    console.log('5: guards')

    // 5a. Allocated invoice — blocked (invoice1 still carries the original deposit allocation;
    // the refund copied a REVERSAL, it never edited or removed that original row — §Decisions).
    check(
      'hasSucceededCharges(invoice1) = true (still allocated, refund is a separate record)',
      await hasSucceededCharges(organizationId, invoice1.instanceId)
    )
    const voidBlockedErr = await expectThrow(() =>
      voidInvoice({ organizationId, userId, invoiceInstanceId: invoice1.instanceId })
    )
    check(
      'voidInvoice blocked on an allocated invoice',
      voidBlockedErr instanceof AuxxError &&
        /Remove recorded payments/.test((voidBlockedErr as Error).message)
    )
    const deleteBlockedErr = await expectThrow(() =>
      deleteInvoice({ organizationId, userId, invoiceInstanceId: invoice1.instanceId })
    )
    check(
      'deleteInvoice blocked on an allocated invoice',
      deleteBlockedErr instanceof AuxxError &&
        /Remove recorded payments/.test((deleteBlockedErr as Error).message)
    )

    // 5b. Intent-only targeting (no allocation, just the checkout-intent column) also blocks.
    const contactE = await handler.create('contact', {
      first_name: '[DA-verify]',
      last_name: 'Intent-only guard',
      primary_email: 'da-verify-e@example.com',
    })
    createdContactIds.push(contactE.instance.id)
    const invoiceE = await handler.create('invoice', {
      invoice_contact: toRecordId('contact', contactE.instance.id),
    })
    createdInvoiceIds.push(invoiceE.instance.id)
    const intentOnlyCharge = await insertSucceededCharge({
      organizationId,
      amount: 5000,
      invoiceInstanceId: invoiceE.instance.id,
    })
    createdTransactionIds.push(intentOnlyCharge.id)

    check(
      'hasSucceededCharges = true via intent column alone (no allocation exists)',
      await hasSucceededCharges(organizationId, invoiceE.instance.id)
    )
    const intentVoidErr = await expectThrow(() =>
      voidInvoice({ organizationId, userId, invoiceInstanceId: invoiceE.instance.id })
    )
    check(
      'voidInvoice blocked on an intent-only-targeted invoice',
      intentVoidErr instanceof AuxxError
    )
    const intentDeleteErr = await expectThrow(() =>
      deleteInvoice({ organizationId, userId, invoiceInstanceId: invoiceE.instance.id })
    )
    check(
      'deleteInvoice blocked on an intent-only-targeted invoice',
      intentDeleteErr instanceof AuxxError
    )

    // 5c. Non-succeeded residue (e.g. an abandoned checkout) does NOT block delete — the
    // pre-delete hook purges it directly so the instance delete never trips the restrict FK.
    const contactF = await handler.create('contact', {
      first_name: '[DA-verify]',
      last_name: 'Residue purge',
      primary_email: 'da-verify-f@example.com',
    })
    createdContactIds.push(contactF.instance.id)
    const invoiceF = await handler.create('invoice', {
      invoice_contact: toRecordId('contact', contactF.instance.id),
    })
    createdInvoiceIds.push(invoiceF.instance.id)
    const lineF = await handler.create('line_item', {
      line_item_name: '[DA-verify] Residue-purge invoice line ($100)',
      line_item_qty: 1,
      line_item_unit_price: 10000,
      line_item_taxable: false,
      line_item_invoice: toRecordId('invoice', invoiceF.instance.id),
    })
    createdLineIds.push(lineF.instance.id)
    const [pendingResidue] = await database
      .insert(schema.PaymentTransaction)
      .values({
        organizationId,
        provider: 'stripe',
        kind: 'charge',
        status: 'pending',
        amount: 10000,
        currency: 'USD',
        invoiceInstanceId: invoiceF.instance.id,
        updatedAt: new Date(),
      })
      .returning()
    createdTransactionIds.push(pendingResidue!.id)

    check(
      'hasSucceededCharges = false for pending-only residue',
      !(await hasSucceededCharges(organizationId, invoiceF.instance.id))
    )
    const residueDeleteErr = await expectThrow(() =>
      deleteInvoice({ organizationId, userId, invoiceInstanceId: invoiceF.instance.id })
    )
    check(
      'deleteInvoice succeeds through pending residue (guard purges it, no restrict-FK throw)',
      residueDeleteErr === undefined,
      residueDeleteErr
    )
    createdInvoiceIds.splice(createdInvoiceIds.indexOf(invoiceF.instance.id), 1)
    check(
      'the pending residue transaction row was purged by the pre-delete hook',
      !(await database.query.PaymentTransaction.findFirst({
        where: (t, { eq }) => eq(t.id, pendingResidue!.id),
      }))
    )
    check('invoiceF instance is gone', !(await instanceExists(invoiceF.instance.id)))
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────────
    console.log(
      `Cleanup: ${createdTransactionIds.length} ledger rows, ${createdInvoiceIds.length} invoices, ` +
        `${createdLineIds.length} lines, ${createdWorkOrderIds.length} work orders, ` +
        `${createdQuoteIds.length} quotes, ${createdContactIds.length} contacts`
    )
    // Ledger rows FIRST, raw SQL (bypasses `hasSucceededCharges` entirely — the point of this
    // teardown order) — mirrors mi1/delete-safety's identical precedent, re-pointed at
    // `PaymentAllocation.paymentInstanceId` (money 16 §C.6 moved the mirror pointer there).
    for (const transactionId of [...new Set(createdTransactionIds)]) {
      try {
        const allocations = await allocationsForTransaction(transactionId)
        for (const allocation of allocations) {
          if (!allocation.paymentInstanceId) continue
          try {
            await handler.delete(toRecordId('payment', allocation.paymentInstanceId))
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
    // Invoices BEFORE lines: `InvoiceLineAllocation.sourceLineItemId` is a restrict FK, freed
    // only once the owning invoice cascades its allocation rows away.
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
    for (const id of [...new Set(createdContactIds)]) {
      try {
        await handler.delete(toRecordId('contact', id))
      } catch (err) {
        console.log(`  cleanup failed for contact:${id}:`, err instanceof Error ? err.message : err)
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
