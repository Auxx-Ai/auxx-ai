// apps/worker/scripts/verify-money-extra-work.ts
/**
 * Extra-work invoicing verification (plans/dispatch/money/19-extra-work-invoicing-surfacing.md §5).
 *
 * Exercises the readiness split (performed work only) and the extra-work invoice flow:
 *  1. done visit + base invoiced + new extra → ready_to_invoice, second invoice via
 *     createExtraWorkInvoice, no double-billing either direction;
 *  2. extra staged on a scheduled (future) visit → NOT ready, but deliberately billable;
 *  3. extra on a canceled visit → excluded everywhere, command rejects;
 *  4. unpriced extra → invisible until priced, then flips readiness;
 *  5. done visit with base NOT invoiced + extra → eligibleVisits amount = template + extra and
 *     createVisitInvoice totals match;
 *  6. the live-repro shape (zero done visits, future extra) → not ready until the visit is done.
 *
 * Creates records prefixed "[EW-verify]" and deletes them at the end (try/finally).
 * WorkOrderVisit rows cascade off EntityInstance deletes.
 *
 * Run (from repo root) under the worker runtime:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/verify-money-extra-work.ts
 */

import { database } from '@auxx/database'
import { scheduleVisit, setVisitStatus } from '@auxx/lib/dispatch'
import {
  computeWorkOrderBillingProjection,
  createExtraWorkInvoice,
  createVisitInvoice,
  getWorkOrderBillingState,
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

async function fieldId(organizationId: string, entityType: string, systemAttribute: string) {
  const def = await database.query.EntityDefinition.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.entityType, entityType)),
  })
  if (!def) return null
  const field = await database.query.CustomField.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.entityDefinitionId, def.id), eq(t.systemAttribute, systemAttribute)),
  })
  return field?.id ?? null
}

async function numberValue(
  organizationId: string,
  entityType: string,
  instanceId: string,
  systemAttribute: string
): Promise<number> {
  const fid = await fieldId(organizationId, entityType, systemAttribute)
  if (!fid) return 0
  const fv = await database.query.FieldValue.findFirst({
    where: (t, { and, eq }) => and(eq(t.entityId, instanceId), eq(t.fieldId, fid)),
  })
  return Number(fv?.valueNumber ?? 0)
}

async function activeVisitAllocations(visitId: string) {
  return database.query.InvoiceVisitAllocation.findMany({
    where: (t, { and, eq }) => and(eq(t.visitId, visitId), eq(t.status, 'active')),
  })
}

async function activeLineAllocations(invoiceId: string) {
  return database.query.InvoiceLineAllocation.findMany({
    where: (t, { and, eq }) => and(eq(t.invoiceId, invoiceId), eq(t.status, 'active')),
  })
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
  const scope = { organizationId, userId }

  const createdLineIds: string[] = []
  const createdInvoiceIds: string[] = []
  const createdWorkOrderIds: string[] = []

  const dayMs = 24 * 60 * 60 * 1000
  const hourMs = 60 * 60 * 1000
  const yesterday = new Date(Date.now() - dayMs)
  const nextWeek = new Date(Date.now() + 7 * dayMs)

  /** per_visit WO with as_needed timing (no auto-draft door) + its M1 placeholder visit. */
  async function newWorkOrder(title: string) {
    const wo = await handler.create('work_order', {
      work_order_title: title,
      work_order_contact: contactRecordId,
      work_order_invoice_timing: 'as_needed',
    })
    createdWorkOrderIds.push(wo.instance.id)
    const visit = await database.query.WorkOrderVisit.findFirst({
      where: (t, { eq }) => eq(t.workOrderId, wo.instance.id),
    })
    if (!visit) throw new Error(`No placeholder visit on ${title}`)
    return { wo, visit }
  }

  async function createLine(input: {
    name: string
    workOrderRecordId: unknown
    unitPrice?: number
    visitId?: string
  }) {
    const line = await handler.create('line_item', {
      line_item_name: input.name,
      line_item_qty: 1,
      ...(input.unitPrice === undefined ? {} : { line_item_unit_price: input.unitPrice }),
      line_item_taxable: false,
      line_item_work_order: input.workOrderRecordId,
      ...(input.visitId ? { line_item_visit_id: input.visitId } : {}),
    })
    createdLineIds.push(line.instance.id)
    return line
  }

  async function billingState(workOrderInstanceId: string) {
    return getWorkOrderBillingState({ ...scope, workOrderInstanceId })
  }
  async function projection(workOrderInstanceId: string) {
    return computeWorkOrderBillingProjection({ ...scope, workOrderInstanceId })
  }

  const contactDef = await database.query.EntityDefinition.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.entityType, 'contact')),
  })
  const contact = contactDef
    ? await database.query.EntityInstance.findFirst({
        columns: { id: true },
        where: (t, { eq }) => eq(t.entityDefinitionId, contactDef.id),
      })
    : null
  if (!contact) throw new Error('No contact in org — cannot test invoices')
  const contactRecordId = toRecordId('contact', contact.id)

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. Forgotten material: done + base invoiced + new extra
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: done visit, base invoiced, forgotten-material extra')
    const c1 = await newWorkOrder('[EW-verify] Case1 forgotten material')
    await createLine({
      name: '[EW-verify] C1 template',
      workOrderRecordId: c1.wo.recordId,
      unitPrice: 11000,
    })
    await scheduleVisit({
      ...scope,
      visitId: c1.visit.id,
      startTime: yesterday,
      endTime: new Date(yesterday.getTime() + hourMs),
    })
    await setVisitStatus({ ...scope, visitId: c1.visit.id, status: 'done' })

    const inv1 = await createVisitInvoice({
      ...scope,
      workOrderInstanceId: c1.wo.instance.id,
      visitIds: [c1.visit.id],
    })
    createdInvoiceIds.push(inv1.instanceId)
    const baseAllocs = await activeVisitAllocations(c1.visit.id)
    check(
      'case1: base invoice → one active base visit allocation',
      baseAllocs.filter((row) => row.kind === 'base').length === 1,
      baseAllocs
    )
    const stateAfterBase = await billingState(c1.wo.instance.id)
    check(
      'case1: eligibleVisits empty after base invoice',
      stateAfterBase.eligibleVisits.length === 0
    )
    check('case1: no extra work yet', stateAfterBase.extraWork.length === 0)

    const extra1 = await createLine({
      name: '[EW-verify] C1 forgotten material',
      workOrderRecordId: c1.wo.recordId,
      unitPrice: 9000,
      visitId: c1.visit.id,
    })
    const proj1 = await projection(c1.wo.instance.id)
    check(
      'case1: extra on done visit → ready_to_invoice',
      proj1.state === 'ready_to_invoice',
      proj1.state
    )
    check('case1: uninvoicedAmount = 9000', proj1.uninvoicedAmount === 9000, proj1.uninvoicedAmount)
    const state1 = await billingState(c1.wo.instance.id)
    check('case1: eligibleVisits still empty (base allocated)', state1.eligibleVisits.length === 0)
    check(
      'case1: extraWork = one done-visit row of 9000',
      state1.extraWork.length === 1 &&
        state1.extraWork[0]!.visitStatus === 'done' &&
        state1.extraWork[0]!.amount === 9000 &&
        state1.extraWork[0]!.visitId === c1.visit.id &&
        !!state1.extraWork[0]!.serviceDate,
      state1.extraWork
    )

    const inv2 = await createExtraWorkInvoice({
      ...scope,
      workOrderInstanceId: c1.wo.instance.id,
      visitIds: [c1.visit.id],
    })
    createdInvoiceIds.push(inv2.instanceId)
    const inv2Total = await numberValue(organizationId, 'invoice', inv2.instanceId, 'invoice_total')
    check('case1: extra invoice total = 9000', inv2Total === 9000, inv2Total)
    const inv2LineAllocs = await activeLineAllocations(inv2.instanceId)
    check(
      'case1: one visit_addition line allocation on the extra invoice',
      inv2LineAllocs.length === 1 &&
        inv2LineAllocs[0]!.kind === 'visit_addition' &&
        inv2LineAllocs[0]!.sourceLineItemId === extra1.instance.id,
      inv2LineAllocs
    )
    const allocsAfterExtra = await activeVisitAllocations(c1.visit.id)
    check(
      'case1: visit carries base + additional allocations, base untouched',
      allocsAfterExtra.filter((row) => row.kind === 'base').length === 1 &&
        allocsAfterExtra.filter((row) => row.kind === 'additional').length === 1,
      allocsAfterExtra
    )
    const rebill = await expectThrow(() =>
      createExtraWorkInvoice({
        ...scope,
        workOrderInstanceId: c1.wo.instance.id,
        visitIds: [c1.visit.id],
      })
    )
    check('case1: re-billing the same extra rejects', rebill !== undefined, rebill)
    const proj1After = await projection(c1.wo.instance.id)
    check(
      'case1: not ready after extra invoiced (drafts pending)',
      proj1After.state !== 'ready_to_invoice' && proj1After.uninvoicedAmount === 0,
      { state: proj1After.state, uninvoiced: proj1After.uninvoicedAmount }
    )

    // ══════════════════════════════════════════════════════════════════════
    // 2. Pre-billing: extra staged on a future (scheduled) visit
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: extra on a scheduled future visit')
    const c2 = await newWorkOrder('[EW-verify] Case2 pre-bill')
    await createLine({
      name: '[EW-verify] C2 template',
      workOrderRecordId: c2.wo.recordId,
      unitPrice: 11000,
    })
    await scheduleVisit({
      ...scope,
      visitId: c2.visit.id,
      startTime: nextWeek,
      endTime: new Date(nextWeek.getTime() + hourMs),
    })
    await createLine({
      name: '[EW-verify] C2 special-order part',
      workOrderRecordId: c2.wo.recordId,
      unitPrice: 5000,
      visitId: c2.visit.id,
    })
    const proj2 = await projection(c2.wo.instance.id)
    check(
      'case2: future extra does NOT make the WO ready',
      proj2.state !== 'ready_to_invoice' && proj2.uninvoicedAmount === 0,
      { state: proj2.state, uninvoiced: proj2.uninvoicedAmount }
    )
    const state2 = await billingState(c2.wo.instance.id)
    check(
      "case2: extraWork lists the staged extra with visitStatus 'scheduled'",
      state2.extraWork.length === 1 && state2.extraWork[0]!.visitStatus === 'scheduled',
      state2.extraWork
    )
    check('case2: eligibleVisits empty', state2.eligibleVisits.length === 0)
    const inv3 = await createExtraWorkInvoice({
      ...scope,
      workOrderInstanceId: c2.wo.instance.id,
      visitIds: [c2.visit.id],
    })
    createdInvoiceIds.push(inv3.instanceId)
    const inv3Total = await numberValue(organizationId, 'invoice', inv3.instanceId, 'invoice_total')
    check('case2: deliberate pre-bill succeeds at 5000', inv3Total === 5000, inv3Total)

    // ══════════════════════════════════════════════════════════════════════
    // 3. Canceled visit extras are not billable
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: extra on a canceled visit')
    const c3 = await newWorkOrder('[EW-verify] Case3 canceled')
    await scheduleVisit({
      ...scope,
      visitId: c3.visit.id,
      startTime: nextWeek,
      endTime: new Date(nextWeek.getTime() + hourMs),
    })
    await createLine({
      name: '[EW-verify] C3 extra',
      workOrderRecordId: c3.wo.recordId,
      unitPrice: 4000,
      visitId: c3.visit.id,
    })
    await setVisitStatus({ ...scope, visitId: c3.visit.id, status: 'canceled' })
    const state3 = await billingState(c3.wo.instance.id)
    check(
      'case3: canceled-visit extra excluded from extraWork',
      state3.extraWork.length === 0,
      state3.extraWork
    )
    const proj3 = await projection(c3.wo.instance.id)
    check(
      'case3: canceled-visit extra excluded from readiness',
      proj3.uninvoicedAmount === 0,
      proj3.uninvoicedAmount
    )
    const canceledBill = await expectThrow(() =>
      createExtraWorkInvoice({
        ...scope,
        workOrderInstanceId: c3.wo.instance.id,
        visitIds: [c3.visit.id],
      })
    )
    check('case3: command rejects canceled-visit extras', canceledBill !== undefined, canceledBill)

    // ══════════════════════════════════════════════════════════════════════
    // 4. Unpriced extras are drafts, not billable work
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: unpriced extra until priced')
    const c4 = await newWorkOrder('[EW-verify] Case4 unpriced')
    await scheduleVisit({
      ...scope,
      visitId: c4.visit.id,
      startTime: yesterday,
      endTime: new Date(yesterday.getTime() + hourMs),
    })
    await setVisitStatus({ ...scope, visitId: c4.visit.id, status: 'done' })
    const unpriced = await createLine({
      name: '[EW-verify] C4 unpriced extra',
      workOrderRecordId: c4.wo.recordId,
      visitId: c4.visit.id,
    })
    const state4 = await billingState(c4.wo.instance.id)
    check(
      'case4: unpriced extra absent from extraWork',
      state4.extraWork.length === 0,
      state4.extraWork
    )
    const proj4 = await projection(c4.wo.instance.id)
    check(
      'case4: unpriced extra adds nothing to uninvoicedAmount',
      proj4.uninvoicedAmount === 0,
      proj4.uninvoicedAmount
    )
    await handler.update(unpriced.recordId, { line_item_unit_price: 9000 })
    const proj4Priced = await projection(c4.wo.instance.id)
    check(
      'case4: pricing the extra flips readiness to 9000',
      proj4Priced.uninvoicedAmount === 9000 && proj4Priced.state === 'ready_to_invoice',
      { state: proj4Priced.state, uninvoiced: proj4Priced.uninvoicedAmount }
    )
    const state4Priced = await billingState(c4.wo.instance.id)
    check(
      'case4: priced extra appears in extraWork',
      state4Priced.extraWork.length === 1,
      state4Priced.extraWork
    )

    // ══════════════════════════════════════════════════════════════════════
    // 5. Base + extra ride together when the base is uninvoiced
    // ══════════════════════════════════════════════════════════════════════
    console.log('5: done visit, base uninvoiced, extra rides along')
    const c5 = await newWorkOrder('[EW-verify] Case5 ride-along')
    await createLine({
      name: '[EW-verify] C5 template',
      workOrderRecordId: c5.wo.recordId,
      unitPrice: 11000,
    })
    await scheduleVisit({
      ...scope,
      visitId: c5.visit.id,
      startTime: yesterday,
      endTime: new Date(yesterday.getTime() + hourMs),
    })
    await setVisitStatus({ ...scope, visitId: c5.visit.id, status: 'done' })
    await createLine({
      name: '[EW-verify] C5 extra',
      workOrderRecordId: c5.wo.recordId,
      unitPrice: 9000,
      visitId: c5.visit.id,
    })
    const state5 = await billingState(c5.wo.instance.id)
    check(
      'case5: eligibleVisits amount = template + extra (20000)',
      state5.eligibleVisits.length === 1 && state5.eligibleVisits[0]!.amount === 20000,
      state5.eligibleVisits
    )
    const inv5 = await createVisitInvoice({
      ...scope,
      workOrderInstanceId: c5.wo.instance.id,
      visitIds: [c5.visit.id],
    })
    createdInvoiceIds.push(inv5.instanceId)
    const inv5Total = await numberValue(organizationId, 'invoice', inv5.instanceId, 'invoice_total')
    check('case5: visit invoice total = 20000 (matches picker)', inv5Total === 20000, inv5Total)
    const state5After = await billingState(c5.wo.instance.id)
    check(
      'case5: extra consumed — extraWork empty',
      state5After.extraWork.length === 0,
      state5After.extraWork
    )
    const rideAgain = await expectThrow(() =>
      createExtraWorkInvoice({
        ...scope,
        workOrderInstanceId: c5.wo.instance.id,
        visitIds: [c5.visit.id],
      })
    )
    check('case5: consumed extra cannot be billed again', rideAgain !== undefined, rideAgain)

    // ══════════════════════════════════════════════════════════════════════
    // 6. The live-repro shape: zero done visits + future extra
    // ══════════════════════════════════════════════════════════════════════
    console.log('6: repro shape — not ready until the visit is done')
    const c6 = await newWorkOrder('[EW-verify] Case6 repro shape')
    await createLine({
      name: '[EW-verify] C6 template',
      workOrderRecordId: c6.wo.recordId,
      unitPrice: 11000,
    })
    await scheduleVisit({
      ...scope,
      visitId: c6.visit.id,
      startTime: nextWeek,
      endTime: new Date(nextWeek.getTime() + hourMs),
    })
    await createLine({
      name: '[EW-verify] C6 staged extra',
      workOrderRecordId: c6.wo.recordId,
      unitPrice: 9000,
      visitId: c6.visit.id,
    })
    const proj6 = await projection(c6.wo.instance.id)
    check(
      'case6: repro shape is NOT ready anymore',
      proj6.state !== 'ready_to_invoice' && proj6.uninvoicedAmount === 0,
      { state: proj6.state, uninvoiced: proj6.uninvoicedAmount }
    )
    await scheduleVisit({
      ...scope,
      visitId: c6.visit.id,
      startTime: yesterday,
      endTime: new Date(yesterday.getTime() + hourMs),
    })
    await setVisitStatus({ ...scope, visitId: c6.visit.id, status: 'done' })
    const proj6Done = await projection(c6.wo.instance.id)
    check(
      'case6: done visit → ready with base + extra (20000)',
      proj6Done.state === 'ready_to_invoice' && proj6Done.uninvoicedAmount === 20000,
      { state: proj6Done.state, uninvoiced: proj6Done.uninvoicedAmount }
    )
    const state6 = await billingState(c6.wo.instance.id)
    check(
      'case6: one eligible visit quoted at 20000',
      state6.eligibleVisits.length === 1 && state6.eligibleVisits[0]!.amount === 20000,
      state6.eligibleVisits
    )
  } finally {
    console.log(
      `Cleanup: ${createdLineIds.length} lines, ${createdInvoiceIds.length} invoices, ` +
        `${createdWorkOrderIds.length} work orders`
    )
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
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => process.exit())
