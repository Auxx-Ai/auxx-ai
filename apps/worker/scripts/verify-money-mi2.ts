// apps/worker/scripts/verify-money-mi2.ts
/**
 * Money MI2 (Invoice Automation) end-to-end verification
 * (plans/dispatch/money/08-mi2-build.md §M cases 1-10, §O.4 cases 12-14). Exercises the REAL
 * trigger doors: `setVisitStatus` (§D, per_visit_completed), the `generateDraftOnCompletion`
 * field-change hook fired by both the visit roll-up AND plain `UnifiedCrudHandler.update`
 * (§E, on_completion), `setInvoiceSchedule`/`sweepInvoiceDrafts`/`materializeInvoiceDrafts`
 * (§F, custom_schedule), M2c's real `pauseEngagement`/`resumeEngagement`/`endEngagement`, and
 * the three `documents.invoice.*` org settings (§O). Also directly calls `generateInvoiceDraft`
 * once to assert its documented `reason` contract.
 *
 * Creates records prefixed "[MI2-verify]" and deletes them at the end (try/finally).
 * `WorkOrderVisit`/`RecurrenceRule` rows cascade off `EntityInstance` deletes (the
 * verify-dispatch-recurring.ts precedent), so deleting a work order cleans up its visits and
 * both its `work_order_visits` and `invoice_drafts` recurrence rules for free.
 *
 * Run (from repo root) under the worker runtime:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/verify-money-mi2.ts
 */

import { database } from '@auxx/database'
import { onCacheEvent } from '@auxx/lib/cache'
import {
  endEngagement,
  pauseEngagement,
  resumeEngagement,
  scheduleVisit,
  setRecurrenceRule,
  setVisitStatus,
} from '@auxx/lib/dispatch'
import { AuxxError } from '@auxx/lib/errors'
import {
  approveQuote,
  clearInvoiceSchedule,
  convertQuoteToWorkOrder,
  deleteInvoiceLine,
  generateInvoiceDraft,
  getInvoiceSchedule,
  markQuoteSent,
  setInvoiceSchedule,
  sweepInvoiceDrafts,
} from '@auxx/lib/money'
import { expandOccurrences, type RecurrencePattern } from '@auxx/lib/recurrence'
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

// ── Date helpers (plain math, no reliance on the engine's own date-fns helpers) ──

function addDaysToIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function weekdayOfIso(iso: string): number {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay()
}

// ── DB helpers ──

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

async function getVisitsSorted(workOrderInstanceId: string) {
  return database.query.WorkOrderVisit.findMany({
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
    orderBy: (t, { asc }) => [asc(t.occurrenceDate), asc(t.startTime)],
  })
}

async function getRuleFor(subjectType: string, subjectId: string) {
  return database.query.RecurrenceRule.findFirst({
    where: (t, { and, eq }) => and(eq(t.subjectType, subjectType), eq(t.subjectId, subjectId)),
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

  /** `listFiltered` helper — invoices matching one `(fieldId, value)` "is" condition. */
  async function listInvoicesFiltered(filterFieldId: string, value: unknown): Promise<string[]> {
    const { ids } = await handler.listFiltered({
      entityDefinitionId: 'invoice',
      filters: [
        {
          id: 'f',
          logicalOperator: 'AND',
          conditions: [{ id: 'c1', fieldId: filterFieldId, operator: 'is', value }],
        },
      ],
      limit: 100,
      mode: 'oneshot',
    })
    return ids
  }

  /** The invoice's OWNED line copies (workOrder empty) — the mi1/gather.ts "owned copies" recipe. */
  async function listOwnedInvoiceLines(invoiceRecordId: unknown): Promise<string[]> {
    const { ids } = await handler.listFiltered({
      entityDefinitionId: 'line_item',
      filters: [
        {
          id: 'owned-lines',
          logicalOperator: 'AND',
          conditions: [
            { id: 'c1', fieldId: 'line_item:invoice', operator: 'is', value: invoiceRecordId },
            { id: 'c2', fieldId: 'line_item:workOrder', operator: 'empty', value: null },
          ],
        },
      ],
      limit: 100,
      mode: 'oneshot',
    })
    return ids
  }

  const todayIso = new Date().toISOString().slice(0, 10)
  const todayWeekday = weekdayOfIso(todayIso)

  const createdLineIds: string[] = []
  const createdInvoiceIds: string[] = []
  const createdWorkOrderIds: string[] = []
  const createdQuoteIds: string[] = []

  let autoEnabledChanged = false
  let originalAutoEnabled: unknown = null
  let defaultTimingChanged = false
  let originalDefaultTiming: unknown = null
  let dateBasisChanged = false
  let originalDateBasis: unknown = null

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

    // ══════════════════════════════════════════════════════════════════════
    // 1. per_visit x per_visit pricing (Q2a) — real setVisitStatus door
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: per_visit x per_visit pricing (Q2a)')
    const wo1 = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case1 per-visit recurring WO',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(wo1.instance.id)
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo1.instance.id,
      pattern: { frequency: 'daily', interval: 1 },
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo1Visits = await getVisitsSorted(wo1.instance.id)
    check(
      'case1 setup: recurring WO materialized at least 2 visits',
      wo1Visits.length >= 2,
      wo1Visits.length
    )
    const v1 = wo1Visits[0]!
    const v2 = wo1Visits[1]!

    const jobSetLine = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case1 job-set line',
      line_item_qty: 1,
      line_item_unit_price: 5000,
      line_item_taxable: true,
      line_item_work_order: wo1.recordId,
    })
    createdLineIds.push(jobSetLine.instance.id)
    const extraLineV1 = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case1 V1 extra',
      line_item_qty: 1,
      line_item_unit_price: 2500,
      line_item_taxable: true,
      line_item_work_order: wo1.recordId,
      line_item_visit_id: v1.id,
    })
    createdLineIds.push(extraLineV1.instance.id)

    await setVisitStatus({ organizationId, userId, visitId: v1.id, status: 'done' })

    const v1Drafts = await listInvoicesFiltered('invoice:visitId', v1.id)
    check('case1: exactly 1 draft created for V1', v1Drafts.length === 1, v1Drafts.length)
    const v1DraftInstanceId = v1Drafts[0]!
    createdInvoiceIds.push(v1DraftInstanceId)
    const v1DraftRecordId = toRecordId('invoice', v1DraftInstanceId)

    const v1OwnedLines = await listOwnedInvoiceLines(v1DraftRecordId)
    check(
      'case1: V1 draft has exactly 2 owned lines',
      v1OwnedLines.length === 2,
      v1OwnedLines.length
    )
    for (const id of v1OwnedLines) createdLineIds.push(id)

    let templateCopyId: string | undefined
    let gatheredCopyId: string | undefined
    for (const id of v1OwnedLines) {
      const src = await fieldValueByAttr(
        organizationId,
        'line_item',
        id,
        'line_item_source_line_id'
      )
      if (src?.valueText) gatheredCopyId = id
      else templateCopyId = id
    }
    check(
      'case1: found exactly one template copy + one gathered copy',
      !!templateCopyId && !!gatheredCopyId,
      { templateCopyId, gatheredCopyId }
    )

    const templateCopyVisitId = await fieldValueByAttr(
      organizationId,
      'line_item',
      templateCopyId!,
      'line_item_visit_id'
    )
    check(
      'case1: template copy stamped with line_item_visit_id = V1',
      templateCopyVisitId?.valueText === v1.id,
      templateCopyVisitId?.valueText
    )

    const gatheredCopySource = await fieldValueByAttr(
      organizationId,
      'line_item',
      gatheredCopyId!,
      'line_item_source_line_id'
    )
    check(
      'case1: gathered copy sourceLineId points at the extra line',
      gatheredCopySource?.valueText === extraLineV1.instance.id,
      gatheredCopySource?.valueText
    )

    const jobSetLineInvoiceFv = await fieldValueByAttr(
      organizationId,
      'line_item',
      jobSetLine.instance.id,
      'line_item_invoice'
    )
    check(
      'case1: job-set source line NOT stamped (template semantics)',
      !jobSetLineInvoiceFv?.relatedEntityId
    )

    const extraLineV1InvoiceFv = await fieldValueByAttr(
      organizationId,
      'line_item',
      extraLineV1.instance.id,
      'line_item_invoice'
    )
    check(
      'case1: extra source line IS stamped',
      extraLineV1InvoiceFv?.relatedEntityId === v1DraftInstanceId
    )

    const v1DraftVisitId = await fieldValueByAttr(
      organizationId,
      'invoice',
      v1DraftInstanceId,
      'invoice_visit_id'
    )
    check('case1: draft invoice_visit_id = V1', v1DraftVisitId?.valueText === v1.id)

    const v1DraftTotal = await fieldValueByAttr(
      organizationId,
      'invoice',
      v1DraftInstanceId,
      'invoice_total'
    )
    const v1DraftBalance = await fieldValueByAttr(
      organizationId,
      'invoice',
      v1DraftInstanceId,
      'invoice_balance'
    )
    check(
      'case1: totals computed, balance = total',
      !!v1DraftTotal?.valueNumber &&
        v1DraftTotal.valueNumber > 0 &&
        v1DraftBalance?.valueNumber === v1DraftTotal.valueNumber,
      { total: v1DraftTotal?.valueNumber, balance: v1DraftBalance?.valueNumber }
    )

    const v1DraftIssuedAt = await fieldValueByAttr(
      organizationId,
      'invoice',
      v1DraftInstanceId,
      'invoice_issued_at'
    )
    check(
      'case1: issuedAt backdated to the visit occurrenceDate (dateBasis default visit_date)',
      String(v1DraftIssuedAt?.valueDate).slice(0, 10) === v1.occurrenceDate,
      { issuedAt: v1DraftIssuedAt?.valueDate, expected: v1.occurrenceDate }
    )

    // Re-complete V1: reset to scheduled, then done again -> no second draft (Q6 dedup).
    await setVisitStatus({ organizationId, userId, visitId: v1.id, status: 'scheduled' })
    await setVisitStatus({ organizationId, userId, visitId: v1.id, status: 'done' })
    const v1DraftsAfterRecomplete = await listInvoicesFiltered('invoice:visitId', v1.id)
    check(
      'case1: re-completing V1 does not create a second draft',
      v1DraftsAfterRecomplete.length === 1,
      v1DraftsAfterRecomplete.length
    )

    // Complete V2 (no extras) -> draft with 1 template line.
    await setVisitStatus({ organizationId, userId, visitId: v2.id, status: 'done' })
    const v2Drafts = await listInvoicesFiltered('invoice:visitId', v2.id)
    check('case1: exactly 1 draft created for V2', v2Drafts.length === 1, v2Drafts.length)
    const v2DraftInstanceId = v2Drafts[0]!
    createdInvoiceIds.push(v2DraftInstanceId)
    const v2OwnedLines = await listOwnedInvoiceLines(toRecordId('invoice', v2DraftInstanceId))
    check(
      'case1: V2 draft has exactly 1 owned (template) line',
      v2OwnedLines.length === 1,
      v2OwnedLines.length
    )
    for (const id of v2OwnedLines) createdLineIds.push(id)

    // ══════════════════════════════════════════════════════════════════════
    // 2. Empty skip (Q5)
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: empty skip (Q5)')
    const wo2a = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case2 zero-lines WO',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(wo2a.instance.id)
    const wo2aVisit = (await getVisitsSorted(wo2a.instance.id))[0]!
    const zeroLineErr = await expectThrow(() =>
      setVisitStatus({ organizationId, userId, visitId: wo2aVisit.id, status: 'done' })
    )
    check(
      'case2: completing a zero-line WO visit does not throw',
      zeroLineErr === undefined,
      zeroLineErr
    )
    const wo2aDrafts = await listInvoicesFiltered('invoice:visitId', wo2aVisit.id)
    check('case2: zero-line WO produces no draft', wo2aDrafts.length === 0, wo2aDrafts.length)

    const wo2b = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case2 no-contact WO',
    })
    createdWorkOrderIds.push(wo2b.instance.id)
    const noContactLine = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case2 no-contact line',
      line_item_qty: 1,
      line_item_unit_price: 1000,
      line_item_taxable: true,
      line_item_work_order: wo2b.recordId,
    })
    createdLineIds.push(noContactLine.instance.id)
    const wo2bVisit = (await getVisitsSorted(wo2b.instance.id))[0]!
    const noContactErr = await expectThrow(() =>
      setVisitStatus({ organizationId, userId, visitId: wo2bVisit.id, status: 'done' })
    )
    check(
      'case2: completing a no-contact WO visit does not throw',
      noContactErr === undefined,
      noContactErr
    )
    const wo2bVisitAfter = await database.query.WorkOrderVisit.findFirst({
      where: (t, { eq }) => eq(t.id, wo2bVisit.id),
    })
    check(
      'case2: status tap succeeded despite the no-contact skip',
      wo2bVisitAfter?.status === 'done',
      wo2bVisitAfter?.status
    )
    const wo2bInvoices = await listInvoicesFiltered('invoice:workOrder', wo2b.recordId)
    check('case2: no-contact WO produces no draft', wo2bInvoices.length === 0, wo2bInvoices.length)

    // ══════════════════════════════════════════════════════════════════════
    // 3. on_completion (Q3a + Q3i), one_off
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: on_completion (one_off)')
    const wo3a = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case3a on_completion via visit roll-up',
      work_order_contact: contactRecordId,
      work_order_invoice_timing: 'on_completion',
    })
    createdWorkOrderIds.push(wo3a.instance.id)
    const wo3aVisit = (await getVisitsSorted(wo3a.instance.id))[0]!
    const wo3aJobSetLine = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case3a job-set line',
      line_item_qty: 1,
      line_item_unit_price: 4000,
      line_item_taxable: true,
      line_item_work_order: wo3a.recordId,
    })
    createdLineIds.push(wo3aJobSetLine.instance.id)
    const wo3aExtraLine = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case3a extra',
      line_item_qty: 1,
      line_item_unit_price: 1500,
      line_item_taxable: true,
      line_item_work_order: wo3a.recordId,
      line_item_visit_id: wo3aVisit.id,
    })
    createdLineIds.push(wo3aExtraLine.instance.id)

    await setVisitStatus({ organizationId, userId, visitId: wo3aVisit.id, status: 'done' })
    const wo3aStatus = await fieldValueByAttr(
      organizationId,
      'work_order',
      wo3a.instance.id,
      'work_order_status'
    )
    check(
      'case3a: WO rolls up to completed',
      wo3aStatus?.optionId === 'completed',
      wo3aStatus?.optionId
    )

    const wo3aInvoices = await listInvoicesFiltered('invoice:workOrder', wo3a.recordId)
    check(
      'case3a: exactly 1 on_completion draft generated',
      wo3aInvoices.length === 1,
      wo3aInvoices.length
    )
    const wo3aDraftId = wo3aInvoices[0]!
    createdInvoiceIds.push(wo3aDraftId)
    const wo3aOwned = await listOwnedInvoiceLines(toRecordId('invoice', wo3aDraftId))
    check('case3a: draft gathers both lines', wo3aOwned.length === 2, wo3aOwned.length)
    for (const id of wo3aOwned) createdLineIds.push(id)
    let wo3aSourcesStamped = true
    for (const srcId of [wo3aJobSetLine.instance.id, wo3aExtraLine.instance.id]) {
      const fv = await fieldValueByAttr(organizationId, 'line_item', srcId, 'line_item_invoice')
      if (fv?.relatedEntityId !== wo3aDraftId) wo3aSourcesStamped = false
    }
    check('case3a: both sources stamped (gathered, not templated)', wo3aSourcesStamped)

    // 3b: manual drawer write also fires the hook.
    const wo3b = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case3b on_completion via manual write',
      work_order_contact: contactRecordId,
      work_order_invoice_timing: 'on_completion',
    })
    createdWorkOrderIds.push(wo3b.instance.id)
    const wo3bLine1 = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case3b line 1',
      line_item_qty: 1,
      line_item_unit_price: 2000,
      line_item_taxable: true,
      line_item_work_order: wo3b.recordId,
    })
    createdLineIds.push(wo3bLine1.instance.id)
    const wo3bLine2 = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case3b line 2',
      line_item_qty: 1,
      line_item_unit_price: 3000,
      line_item_taxable: true,
      line_item_work_order: wo3b.recordId,
    })
    createdLineIds.push(wo3bLine2.instance.id)

    await handler.update(wo3b.recordId, { work_order_status: 'completed' })
    const wo3bInvoices = await listInvoicesFiltered('invoice:workOrder', wo3b.recordId)
    check(
      'case3b: manual drawer write to completed also generates a draft',
      wo3bInvoices.length === 1,
      wo3bInvoices.length
    )
    const wo3bDraftId = wo3bInvoices[0]!
    createdInvoiceIds.push(wo3bDraftId)
    const wo3bOwned = await listOwnedInvoiceLines(toRecordId('invoice', wo3bDraftId))
    check('case3b: draft gathers both lines', wo3bOwned.length === 2, wo3bOwned.length)
    for (const id of wo3bOwned) createdLineIds.push(id)

    // re-complete -> empty-skip, no dupe.
    await handler.update(wo3b.recordId, { work_order_status: 'completed' })
    const wo3bInvoicesAfter = await listInvoicesFiltered('invoice:workOrder', wo3b.recordId)
    check(
      'case3b: re-writing completed again does not create a second draft (empty-skip)',
      wo3bInvoicesAfter.length === 1,
      wo3bInvoicesAfter.length
    )

    // ══════════════════════════════════════════════════════════════════════
    // 4. on_completion x recurring — real endEngagement
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: on_completion x recurring (endEngagement)')
    const wo4 = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case4 recurring on_completion',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(wo4.instance.id)
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo4.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [todayWeekday] },
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    await handler.update(wo4.recordId, { work_order_invoice_timing: 'on_completion' })
    const wo4Line1 = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case4 line 1',
      line_item_qty: 1,
      line_item_unit_price: 6000,
      line_item_taxable: true,
      line_item_work_order: wo4.recordId,
    })
    createdLineIds.push(wo4Line1.instance.id)

    await endEngagement({ organizationId, userId, workOrderInstanceId: wo4.instance.id })
    const wo4Status = await fieldValueByAttr(
      organizationId,
      'work_order',
      wo4.instance.id,
      'work_order_status'
    )
    check('case4: engagement ends', wo4Status?.optionId === 'ended', wo4Status?.optionId)
    const wo4Invoices = await listInvoicesFiltered('invoice:workOrder', wo4.recordId)
    check(
      'case4: endEngagement generates the final on_completion draft',
      wo4Invoices.length === 1,
      wo4Invoices.length
    )
    const wo4DraftId = wo4Invoices[0]!
    createdInvoiceIds.push(wo4DraftId)
    const wo4Owned = await listOwnedInvoiceLines(toRecordId('invoice', wo4DraftId))
    check('case4: draft gathers the one line', wo4Owned.length === 1, wo4Owned.length)
    for (const id of wo4Owned) createdLineIds.push(id)

    // ══════════════════════════════════════════════════════════════════════
    // 5. custom_schedule x fixed (Q4a)
    // ══════════════════════════════════════════════════════════════════════
    console.log('5: custom_schedule x fixed (Q4a)')
    const wo5 = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case5 custom_schedule fixed',
      work_order_contact: contactRecordId,
      work_order_pricing_model: 'fixed',
      work_order_invoice_timing: 'custom_schedule',
    })
    createdWorkOrderIds.push(wo5.instance.id)
    const wo5JobSetLine1 = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case5 contract line 1',
      line_item_qty: 1,
      line_item_unit_price: 30000,
      line_item_taxable: true,
      line_item_work_order: wo5.recordId,
    })
    createdLineIds.push(wo5JobSetLine1.instance.id)
    const wo5JobSetLine2 = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case5 contract line 2',
      line_item_qty: 1,
      line_item_unit_price: 5000,
      line_item_taxable: true,
      line_item_work_order: wo5.recordId,
    })
    createdLineIds.push(wo5JobSetLine2.instance.id)

    const case5TargetWeekday = (todayWeekday + 3) % 7
    const case5Pattern: RecurrencePattern = {
      frequency: 'weekly',
      interval: 1,
      weekdays: [case5TargetWeekday],
    }
    await setInvoiceSchedule({
      organizationId,
      userId,
      workOrderInstanceId: wo5.instance.id,
      pattern: case5Pattern,
      timezone: 'UTC',
    })
    const wo5InvoicesInitial = await listInvoicesFiltered('invoice:workOrder', wo5.recordId)
    check(
      'case5 setup: no drafts from the initial same-day materialize (off-weekday pattern)',
      wo5InvoicesInitial.length === 0,
      wo5InvoicesInitial.length
    )

    const case5AnchorIso = addDaysToIso(todayIso, -14)
    const case5Boundary = new Date(`${case5AnchorIso}T01:00:00.000Z`)
    await database.$client.query(
      'UPDATE "RecurrenceRule" SET anchor = $1, "effectiveFrom" = $1, "materializedUntil" = $2 WHERE "subjectType" = $3 AND "subjectId" = $4',
      [case5AnchorIso, case5Boundary, 'invoice_drafts', wo5.instance.id]
    )
    const case5ExpectedOccurrences = expandOccurrences(case5Pattern, {
      anchor: case5AnchorIso,
      timezone: 'UTC',
      from: case5Boundary,
      to: new Date(),
      startMinute: 0,
    })
    check(
      'case5 setup: backdating produces at least 1 due occurrence',
      case5ExpectedOccurrences.length >= 1,
      case5ExpectedOccurrences.length
    )

    await sweepInvoiceDrafts()

    const wo5InvoicesAfterSweep = await listInvoicesFiltered('invoice:workOrder', wo5.recordId)
    check(
      'case5: sweep generates one draft per due occurrence',
      wo5InvoicesAfterSweep.length === case5ExpectedOccurrences.length,
      { actual: wo5InvoicesAfterSweep.length, expected: case5ExpectedOccurrences.length }
    )
    for (const id of wo5InvoicesAfterSweep) createdInvoiceIds.push(id)
    let case5AllFullTemplateCopies = true
    for (const invId of wo5InvoicesAfterSweep) {
      const owned = await listOwnedInvoiceLines(toRecordId('invoice', invId))
      for (const id of owned) createdLineIds.push(id)
      if (owned.length !== 2) case5AllFullTemplateCopies = false
      for (const id of owned) {
        const src = await fieldValueByAttr(
          organizationId,
          'line_item',
          id,
          'line_item_source_line_id'
        )
        if (src?.valueText) case5AllFullTemplateCopies = false
      }
    }
    check(
      'case5: every draft is a full (2-line) template copy, no sourceLineId',
      case5AllFullTemplateCopies
    )
    let case5SourcesNeverStamped = true
    for (const srcId of [wo5JobSetLine1.instance.id, wo5JobSetLine2.instance.id]) {
      const fv = await fieldValueByAttr(organizationId, 'line_item', srcId, 'line_item_invoice')
      if (fv?.relatedEntityId) case5SourcesNeverStamped = false
    }
    check(
      'case5: job-set source lines never stamped across repeated occurrences',
      case5SourcesNeverStamped
    )

    const wo5RuleAfterSweep = await getRuleFor('invoice_drafts', wo5.instance.id)
    check(
      'case5: cursor (materializedUntil) advanced past the backdated boundary',
      !!wo5RuleAfterSweep?.materializedUntil &&
        wo5RuleAfterSweep.materializedUntil.getTime() > case5Boundary.getTime(),
      wo5RuleAfterSweep?.materializedUntil
    )

    await sweepInvoiceDrafts()
    const wo5InvoicesAfterSecondSweep = await listInvoicesFiltered(
      'invoice:workOrder',
      wo5.recordId
    )
    check(
      'case5: sweeping again produces 0 new drafts (cursor holds)',
      wo5InvoicesAfterSecondSweep.length === wo5InvoicesAfterSweep.length,
      wo5InvoicesAfterSecondSweep.length
    )

    // ══════════════════════════════════════════════════════════════════════
    // 6. custom_schedule x per_visit — gather content collapses on backlog
    // ══════════════════════════════════════════════════════════════════════
    console.log('6: custom_schedule x per_visit')
    const wo6 = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case6 custom_schedule per_visit',
      work_order_contact: contactRecordId,
      work_order_invoice_timing: 'custom_schedule',
    })
    createdWorkOrderIds.push(wo6.instance.id)
    const wo6Extra1 = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case6 extra 1',
      line_item_qty: 1,
      line_item_unit_price: 1200,
      line_item_taxable: true,
      line_item_work_order: wo6.recordId,
    })
    createdLineIds.push(wo6Extra1.instance.id)
    const wo6Extra2 = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case6 extra 2',
      line_item_qty: 1,
      line_item_unit_price: 800,
      line_item_taxable: true,
      line_item_work_order: wo6.recordId,
    })
    createdLineIds.push(wo6Extra2.instance.id)

    const case6TargetWeekday = (todayWeekday + 2) % 7
    const case6Pattern: RecurrencePattern = {
      frequency: 'weekly',
      interval: 1,
      weekdays: [case6TargetWeekday],
    }
    await setInvoiceSchedule({
      organizationId,
      userId,
      workOrderInstanceId: wo6.instance.id,
      pattern: case6Pattern,
      timezone: 'UTC',
    })
    const case6AnchorIso = addDaysToIso(todayIso, -14)
    const case6Boundary = new Date(`${case6AnchorIso}T01:00:00.000Z`)
    await database.$client.query(
      'UPDATE "RecurrenceRule" SET anchor = $1, "effectiveFrom" = $1, "materializedUntil" = $2 WHERE "subjectType" = $3 AND "subjectId" = $4',
      [case6AnchorIso, case6Boundary, 'invoice_drafts', wo6.instance.id]
    )
    const case6ExpectedOccurrences = expandOccurrences(case6Pattern, {
      anchor: case6AnchorIso,
      timezone: 'UTC',
      from: case6Boundary,
      to: new Date(),
      startMinute: 0,
    })
    check(
      'case6 setup: backdating produces at least 2 due occurrences (to prove collapse)',
      case6ExpectedOccurrences.length >= 2,
      case6ExpectedOccurrences.length
    )

    await sweepInvoiceDrafts()
    const wo6Invoices = await listInvoicesFiltered('invoice:workOrder', wo6.recordId)
    check(
      'case6: multiple missed occurrences collapse to exactly 1 gather draft',
      wo6Invoices.length === 1,
      wo6Invoices.length
    )
    const wo6DraftId = wo6Invoices[0]!
    createdInvoiceIds.push(wo6DraftId)
    const wo6Owned = await listOwnedInvoiceLines(toRecordId('invoice', wo6DraftId))
    check('case6: draft gathers both accrued extras', wo6Owned.length === 2, wo6Owned.length)
    for (const id of wo6Owned) createdLineIds.push(id)
    let wo6SourcesStamped = true
    for (const srcId of [wo6Extra1.instance.id, wo6Extra2.instance.id]) {
      const fv = await fieldValueByAttr(organizationId, 'line_item', srcId, 'line_item_invoice')
      if (fv?.relatedEntityId !== wo6DraftId) wo6SourcesStamped = false
    }
    check('case6: both accrued sources stamped', wo6SourcesStamped)

    await sweepInvoiceDrafts()
    const wo6InvoicesAfter = await listInvoicesFiltered('invoice:workOrder', wo6.recordId)
    check(
      'case6: next sweep with nothing new produces no additional draft (empty-skip)',
      wo6InvoicesAfter.length === 1,
      wo6InvoicesAfter.length
    )

    // ══════════════════════════════════════════════════════════════════════
    // 7. Pause gate (Q8a)
    // ══════════════════════════════════════════════════════════════════════
    console.log('7: pause gate (Q8a)')
    const wo7 = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case7 recurring pause gate',
      work_order_contact: contactRecordId,
      work_order_pricing_model: 'fixed',
    })
    createdWorkOrderIds.push(wo7.instance.id)
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo7.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [todayWeekday] },
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    await handler.update(wo7.recordId, { work_order_invoice_timing: 'custom_schedule' })
    const wo7Line = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case7 contract line',
      line_item_qty: 1,
      line_item_unit_price: 9000,
      line_item_taxable: true,
      line_item_work_order: wo7.recordId,
    })
    createdLineIds.push(wo7Line.instance.id)

    const case7TargetWeekday = (todayWeekday + 4) % 7
    await setInvoiceSchedule({
      organizationId,
      userId,
      workOrderInstanceId: wo7.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [case7TargetWeekday] },
      timezone: 'UTC',
    })

    await pauseEngagement({ organizationId, userId, workOrderInstanceId: wo7.instance.id })
    const wo7StatusPaused = await fieldValueByAttr(
      organizationId,
      'work_order',
      wo7.instance.id,
      'work_order_status'
    )
    check(
      'case7 setup: engagement paused',
      wo7StatusPaused?.optionId === 'paused',
      wo7StatusPaused?.optionId
    )

    const case7AnchorIso = addDaysToIso(todayIso, -14)
    const case7Boundary = new Date(`${case7AnchorIso}T01:00:00.000Z`)
    await database.$client.query(
      'UPDATE "RecurrenceRule" SET anchor = $1, "effectiveFrom" = $1, "materializedUntil" = $2 WHERE "subjectType" = $3 AND "subjectId" = $4',
      [case7AnchorIso, case7Boundary, 'invoice_drafts', wo7.instance.id]
    )

    await sweepInvoiceDrafts()
    const wo7InvoicesWhilePaused = await listInvoicesFiltered('invoice:workOrder', wo7.recordId)
    check(
      'case7: paused engagement generates nothing despite a due occurrence',
      wo7InvoicesWhilePaused.length === 0,
      wo7InvoicesWhilePaused.length
    )
    const wo7RuleAfterPausedSweep = await getRuleFor('invoice_drafts', wo7.instance.id)
    check(
      'case7: cursor still advances while paused (no-backfill mechanic)',
      !!wo7RuleAfterPausedSweep?.materializedUntil &&
        wo7RuleAfterPausedSweep.materializedUntil.getTime() > case7Boundary.getTime(),
      wo7RuleAfterPausedSweep?.materializedUntil
    )

    // 7b: resume -> next occurrence generates.
    await resumeEngagement({ organizationId, userId, workOrderInstanceId: wo7.instance.id })
    const wo7StatusActive = await fieldValueByAttr(
      organizationId,
      'work_order',
      wo7.instance.id,
      'work_order_status'
    )
    check(
      'case7: resume -> active',
      wo7StatusActive?.optionId === 'active',
      wo7StatusActive?.optionId
    )

    const case7Boundary2 = new Date(`${addDaysToIso(todayIso, -7)}T01:00:00.000Z`)
    await database.$client.query(
      'UPDATE "RecurrenceRule" SET "materializedUntil" = $1 WHERE "subjectType" = $2 AND "subjectId" = $3',
      [case7Boundary2, 'invoice_drafts', wo7.instance.id]
    )
    await sweepInvoiceDrafts()
    const wo7InvoicesAfterResume = await listInvoicesFiltered('invoice:workOrder', wo7.recordId)
    check(
      'case7: resumed engagement generates on the next due occurrence',
      wo7InvoicesAfterResume.length === 1,
      wo7InvoicesAfterResume.length
    )
    for (const id of wo7InvoicesAfterResume) createdInvoiceIds.push(id)
    for (const invId of wo7InvoicesAfterResume) {
      const owned = await listOwnedInvoiceLines(toRecordId('invoice', invId))
      for (const id of owned) createdLineIds.push(id)
    }

    // 7c: one_off + completed + due occurrence -> still generates (Q8 carve-out).
    const wo7c = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case7c one_off completed carve-out',
      work_order_contact: contactRecordId,
      work_order_pricing_model: 'fixed',
      work_order_invoice_timing: 'custom_schedule',
    })
    createdWorkOrderIds.push(wo7c.instance.id)
    const wo7cLine = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case7c contract line',
      line_item_qty: 1,
      line_item_unit_price: 4400,
      line_item_taxable: true,
      line_item_work_order: wo7c.recordId,
    })
    createdLineIds.push(wo7cLine.instance.id)
    const case7cTargetWeekday = (todayWeekday + 5) % 7
    await setInvoiceSchedule({
      organizationId,
      userId,
      workOrderInstanceId: wo7c.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [case7cTargetWeekday] },
      timezone: 'UTC',
    })
    await handler.update(wo7c.recordId, { work_order_status: 'completed' })
    const case7cAnchorIso = addDaysToIso(todayIso, -14)
    const case7cBoundary = new Date(`${case7cAnchorIso}T01:00:00.000Z`)
    await database.$client.query(
      'UPDATE "RecurrenceRule" SET anchor = $1, "effectiveFrom" = $1, "materializedUntil" = $2 WHERE "subjectType" = $3 AND "subjectId" = $4',
      [case7cAnchorIso, case7cBoundary, 'invoice_drafts', wo7c.instance.id]
    )
    await sweepInvoiceDrafts()
    const wo7cInvoices = await listInvoicesFiltered('invoice:workOrder', wo7c.recordId)
    check(
      'case7c: one_off completed WO still generates scheduled drafts (Q8 carve-out)',
      wo7cInvoices.length >= 1,
      wo7cInvoices.length
    )
    for (const id of wo7cInvoices) createdInvoiceIds.push(id)
    for (const invId of wo7cInvoices) {
      const owned = await listOwnedInvoiceLines(toRecordId('invoice', invId))
      for (const id of owned) createdLineIds.push(id)
    }

    // ══════════════════════════════════════════════════════════════════════
    // 8. Rule mutations
    // ══════════════════════════════════════════════════════════════════════
    console.log('8: rule mutations')
    const wo8 = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case8 rule mutations',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(wo8.instance.id)

    const rejectTimingErr = await expectThrow(() =>
      setInvoiceSchedule({
        organizationId,
        userId,
        workOrderInstanceId: wo8.instance.id,
        pattern: { frequency: 'weekly', interval: 1, weekdays: [1] },
        timezone: 'UTC',
      })
    )
    check(
      'case8: setInvoiceSchedule rejects when timing != custom_schedule',
      rejectTimingErr instanceof AuxxError &&
        /Custom schedule/.test((rejectTimingErr as Error).message),
      rejectTimingErr
    )

    await handler.update(wo8.recordId, { work_order_invoice_timing: 'custom_schedule' })

    const invalidPatternErr = await expectThrow(() =>
      setInvoiceSchedule({
        organizationId,
        userId,
        workOrderInstanceId: wo8.instance.id,
        pattern: { frequency: 'weekly', interval: 1 } as RecurrencePattern, // no weekdays
        timezone: 'UTC',
      })
    )
    check(
      'case8: invalid pattern rejected by zod',
      invalidPatternErr instanceof AuxxError &&
        /Invalid recurrence pattern/.test((invalidPatternErr as Error).message),
      invalidPatternErr
    )

    const rule8First = await setInvoiceSchedule({
      organizationId,
      userId,
      workOrderInstanceId: wo8.instance.id,
      pattern: { frequency: 'monthly', interval: 1, monthDay: 1 },
      timezone: 'UTC',
    })
    const rule8Second = await setInvoiceSchedule({
      organizationId,
      userId,
      workOrderInstanceId: wo8.instance.id,
      pattern: { frequency: 'monthly', interval: 2, monthDay: 15 },
      timezone: 'UTC',
    })
    check('case8: second save upserts the same rule row', rule8First.id === rule8Second.id, {
      first: rule8First.id,
      second: rule8Second.id,
    })
    const rule8Refetched = await getInvoiceSchedule({
      organizationId,
      workOrderInstanceId: wo8.instance.id,
    })
    const rule8Pattern = rule8Refetched?.pattern as unknown as RecurrencePattern | undefined
    check(
      'case8: upsert persisted the new pattern',
      rule8Pattern?.monthDay === 15 && rule8Pattern?.interval === 2,
      rule8Pattern
    )

    // Visit rule + invoice rule coexist.
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo8.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [todayWeekday] },
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const visitRule8 = await getRuleFor('work_order_visits', wo8.instance.id)
    const invoiceRule8 = await getRuleFor('invoice_drafts', wo8.instance.id)
    check(
      'case8: visit rule + invoice rule coexist on the same work order',
      !!visitRule8 && !!invoiceRule8 && visitRule8.id !== invoiceRule8.id,
      { visitRuleId: visitRule8?.id, invoiceRuleId: invoiceRule8?.id }
    )

    // clearInvoiceSchedule deletes the rule, keeps drafts — generate one first.
    await handler.update(wo8.recordId, { work_order_pricing_model: 'fixed' })
    const case8Line = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case8 contract line',
      line_item_qty: 1,
      line_item_unit_price: 2200,
      line_item_taxable: true,
      line_item_work_order: wo8.recordId,
    })
    createdLineIds.push(case8Line.instance.id)
    const case8AnchorIso = addDaysToIso(todayIso, -14)
    const case8Boundary = new Date(`${case8AnchorIso}T01:00:00.000Z`)
    await database.$client.query(
      'UPDATE "RecurrenceRule" SET pattern = $1::jsonb, anchor = $2, "effectiveFrom" = $2, "materializedUntil" = $3 WHERE "subjectType" = $4 AND "subjectId" = $5',
      [
        JSON.stringify({ frequency: 'weekly', interval: 1, weekdays: [(todayWeekday + 6) % 7] }),
        case8AnchorIso,
        case8Boundary,
        'invoice_drafts',
        wo8.instance.id,
      ]
    )
    await sweepInvoiceDrafts()
    const wo8InvoicesBeforeClear = await listInvoicesFiltered('invoice:workOrder', wo8.recordId)
    check(
      'case8 setup: at least 1 draft exists before clearing the schedule',
      wo8InvoicesBeforeClear.length >= 1,
      wo8InvoicesBeforeClear.length
    )
    for (const id of wo8InvoicesBeforeClear) createdInvoiceIds.push(id)
    for (const invId of wo8InvoicesBeforeClear) {
      const owned = await listOwnedInvoiceLines(toRecordId('invoice', invId))
      for (const id of owned) createdLineIds.push(id)
    }

    await clearInvoiceSchedule({ organizationId, workOrderInstanceId: wo8.instance.id })
    const rule8AfterClear = await getInvoiceSchedule({
      organizationId,
      workOrderInstanceId: wo8.instance.id,
    })
    check('case8: clearInvoiceSchedule deletes the rule', rule8AfterClear === null, rule8AfterClear)
    let wo8DraftsStillExist = true
    for (const id of wo8InvoicesBeforeClear) {
      if (!(await instanceExists(id))) wo8DraftsStillExist = false
    }
    check('case8: clearInvoiceSchedule leaves existing drafts untouched', wo8DraftsStillExist)

    // ══════════════════════════════════════════════════════════════════════
    // 9. Draft integrity
    // ══════════════════════════════════════════════════════════════════════
    console.log('9: draft integrity')
    const inv9Number = await fieldValueByAttr(
      organizationId,
      'invoice',
      v1DraftInstanceId,
      'invoice_number'
    )
    check(
      'case9: generated draft carries an INV number',
      !!inv9Number?.valueText?.startsWith('INV-'),
      inv9Number?.valueText
    )

    // Late-completion backdate test (independent WO — five days late).
    const wo9 = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case9 late-completion backdate',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(wo9.instance.id)
    const wo9Visit = (await getVisitsSorted(wo9.instance.id))[0]!
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: wo9Visit.id,
      startTime: fiveDaysAgo,
      endTime: new Date(fiveDaysAgo.getTime() + 60 * 60_000),
    })
    const wo9Line = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case9 late line',
      line_item_qty: 1,
      line_item_unit_price: 1800,
      line_item_taxable: true,
      line_item_work_order: wo9.recordId,
      line_item_visit_id: wo9Visit.id,
    })
    createdLineIds.push(wo9Line.instance.id)

    await setVisitStatus({ organizationId, userId, visitId: wo9Visit.id, status: 'done' })
    const wo9Invoices = await listInvoicesFiltered('invoice:visitId', wo9Visit.id)
    check(
      'case9: late-completed visit generates a draft',
      wo9Invoices.length === 1,
      wo9Invoices.length
    )
    const wo9DraftId = wo9Invoices[0]!
    createdInvoiceIds.push(wo9DraftId)
    const wo9Owned = await listOwnedInvoiceLines(toRecordId('invoice', wo9DraftId))
    for (const id of wo9Owned) createdLineIds.push(id)

    const expectedLateDateIso = fiveDaysAgo.toISOString().slice(0, 10)
    const wo9IssuedAt = await fieldValueByAttr(
      organizationId,
      'invoice',
      wo9DraftId,
      'invoice_issued_at'
    )
    check(
      'case9: issuedAt carries the visit date, not today (Q9b backdated)',
      String(wo9IssuedAt?.valueDate).slice(0, 10) === expectedLateDateIso,
      { issuedAt: wo9IssuedAt?.valueDate, expected: expectedLateDateIso }
    )

    const dueDaysSetting = await getOrganizationSetting({
      organizationId,
      key: 'documents.invoice.dueDays',
    })
    const dueDays = Number(dueDaysSetting ?? 30)
    const expectedDueDateIso = new Date(Date.now() + dueDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    const wo9DueDate = await fieldValueByAttr(
      organizationId,
      'invoice',
      wo9DraftId,
      'invoice_due_date'
    )
    check(
      'case9: dueDate counts from generation day, never the backdated issuedAt',
      String(wo9DueDate?.valueDate).slice(0, 10) === expectedDueDateIso,
      { dueDate: wo9DueDate?.valueDate, expected: expectedDueDateIso }
    )

    const wo9Status = await fieldValueByAttr(
      organizationId,
      'invoice',
      wo9DraftId,
      'invoice_status'
    )
    check('case9: draft sits at status draft', wo9Status?.optionId === 'draft', wo9Status?.optionId)

    const paidWriteErr = await expectThrow(() =>
      handler.update(toRecordId('invoice', wo9DraftId), { invoice_status: 'paid' })
    )
    check(
      'case9: manual invoice_status=paid on a generated draft is rejected (MI1 guard)',
      paidWriteErr instanceof AuxxError,
      paidWriteErr
    )

    // deleteInvoiceLine semantics (reuse case1's V1 draft copies).
    await deleteInvoiceLine({ organizationId, userId, lineInstanceId: templateCopyId! })
    createdLineIds.splice(createdLineIds.indexOf(templateCopyId!), 1)
    const jobSetLineAfterDelete = await fieldValueByAttr(
      organizationId,
      'line_item',
      jobSetLine.instance.id,
      'line_item_invoice'
    )
    check(
      'case9: deleting a template copy frees nothing (source stays unstamped)',
      !jobSetLineAfterDelete?.relatedEntityId
    )

    await deleteInvoiceLine({ organizationId, userId, lineInstanceId: gatheredCopyId! })
    createdLineIds.splice(createdLineIds.indexOf(gatheredCopyId!), 1)
    const extraLineAfterDelete = await fieldValueByAttr(
      organizationId,
      'line_item',
      extraLineV1.instance.id,
      'line_item_invoice'
    )
    check(
      'case9: deleting a gathered copy frees the source',
      !extraLineAfterDelete?.relatedEntityId
    )

    // ══════════════════════════════════════════════════════════════════════
    // 12. Master switch (documents.invoice.autoEnabled) — §O.4
    // ══════════════════════════════════════════════════════════════════════
    console.log('12: master switch (documents.invoice.autoEnabled)')
    originalAutoEnabled = await getOrganizationSetting({
      organizationId,
      key: 'documents.invoice.autoEnabled',
    })
    await updateOrganizationSetting({
      organizationId,
      key: 'documents.invoice.autoEnabled',
      value: false,
    })
    await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })
    autoEnabledChanged = true

    const wo12a = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case12a master-switch per_visit',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(wo12a.instance.id)
    const wo12aLine = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case12a line',
      line_item_qty: 1,
      line_item_unit_price: 1000,
      line_item_taxable: true,
      line_item_work_order: wo12a.recordId,
    })
    createdLineIds.push(wo12aLine.instance.id)
    const wo12aVisit = (await getVisitsSorted(wo12a.instance.id))[0]!
    await setVisitStatus({ organizationId, userId, visitId: wo12aVisit.id, status: 'done' })
    const wo12aInvoices = await listInvoicesFiltered('invoice:visitId', wo12aVisit.id)
    check(
      'case12: per_visit door produces zero drafts while disabled',
      wo12aInvoices.length === 0,
      wo12aInvoices.length
    )

    const directResult = await generateInvoiceDraft({
      organizationId,
      workOrderInstanceId: wo12a.instance.id,
      trigger: 'per_visit',
      visitId: wo12aVisit.id,
    })
    check(
      'case12: generateInvoiceDraft returns reason "disabled"',
      directResult.created === false && directResult.reason === 'disabled',
      directResult
    )

    const wo12b = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case12b master-switch on_completion',
      work_order_contact: contactRecordId,
      work_order_invoice_timing: 'on_completion',
    })
    createdWorkOrderIds.push(wo12b.instance.id)
    const wo12bLine = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case12b line',
      line_item_qty: 1,
      line_item_unit_price: 1000,
      line_item_taxable: true,
      line_item_work_order: wo12b.recordId,
    })
    createdLineIds.push(wo12bLine.instance.id)
    await handler.update(wo12b.recordId, { work_order_status: 'completed' })
    const wo12bInvoices = await listInvoicesFiltered('invoice:workOrder', wo12b.recordId)
    check(
      'case12: on_completion hook produces zero drafts while disabled',
      wo12bInvoices.length === 0,
      wo12bInvoices.length
    )

    const wo12c = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case12c master-switch custom_schedule',
      work_order_contact: contactRecordId,
      work_order_pricing_model: 'fixed',
      work_order_invoice_timing: 'custom_schedule',
    })
    createdWorkOrderIds.push(wo12c.instance.id)
    const wo12cLine = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case12c contract line',
      line_item_qty: 1,
      line_item_unit_price: 2500,
      line_item_taxable: true,
      line_item_work_order: wo12c.recordId,
    })
    createdLineIds.push(wo12cLine.instance.id)
    const case12cTargetWeekday = (todayWeekday + 1) % 7
    await setInvoiceSchedule({
      organizationId,
      userId,
      workOrderInstanceId: wo12c.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [case12cTargetWeekday] },
      timezone: 'UTC',
    })
    const case12cAnchorIso = addDaysToIso(todayIso, -14)
    const case12cBoundary = new Date(`${case12cAnchorIso}T01:00:00.000Z`)
    await database.$client.query(
      'UPDATE "RecurrenceRule" SET anchor = $1, "effectiveFrom" = $1, "materializedUntil" = $2 WHERE "subjectType" = $3 AND "subjectId" = $4',
      [case12cAnchorIso, case12cBoundary, 'invoice_drafts', wo12c.instance.id]
    )
    await sweepInvoiceDrafts()
    const wo12cInvoices = await listInvoicesFiltered('invoice:workOrder', wo12c.recordId)
    check(
      'case12: sweep produces zero drafts while disabled',
      wo12cInvoices.length === 0,
      wo12cInvoices.length
    )

    await updateOrganizationSetting({
      organizationId,
      key: 'documents.invoice.autoEnabled',
      value: true,
    })
    await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })

    await setVisitStatus({ organizationId, userId, visitId: wo12aVisit.id, status: 'done' })
    const wo12aInvoicesAfterFlip = await listInvoicesFiltered('invoice:visitId', wo12aVisit.id)
    check(
      'case12: re-triggering after flipping the switch back on generates a draft',
      wo12aInvoicesAfterFlip.length === 1,
      wo12aInvoicesAfterFlip.length
    )
    for (const id of wo12aInvoicesAfterFlip) createdInvoiceIds.push(id)
    for (const invId of wo12aInvoicesAfterFlip) {
      const owned = await listOwnedInvoiceLines(toRecordId('invoice', invId))
      for (const id of owned) createdLineIds.push(id)
    }

    await updateOrganizationSetting({
      organizationId,
      key: 'documents.invoice.autoEnabled',
      value: originalAutoEnabled as never,
    })
    await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })
    autoEnabledChanged = false

    // ══════════════════════════════════════════════════════════════════════
    // 13. Default timing (documents.invoice.defaultTiming) — §O.4
    // ══════════════════════════════════════════════════════════════════════
    console.log('13: default timing (documents.invoice.defaultTiming)')
    originalDefaultTiming = await getOrganizationSetting({
      organizationId,
      key: 'documents.invoice.defaultTiming',
    })
    await updateOrganizationSetting({
      organizationId,
      key: 'documents.invoice.defaultTiming',
      value: 'on_completion',
    })
    await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })
    defaultTimingChanged = true

    const case13Quote = await handler.create('quote', {
      quote_title: '[MI2-verify] Case13 default-timing quote',
      quote_contact: contactRecordId,
    })
    createdQuoteIds.push(case13Quote.instance.id)
    const case13QuoteTiming = await fieldValueByAttr(
      organizationId,
      'quote',
      case13Quote.instance.id,
      'quote_invoice_timing'
    )
    check(
      'case13: new quote carries the new default timing',
      case13QuoteTiming?.optionId === 'on_completion',
      case13QuoteTiming?.optionId
    )

    const case13Wo = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case13 default-timing WO',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(case13Wo.instance.id)
    const case13WoTiming = await fieldValueByAttr(
      organizationId,
      'work_order',
      case13Wo.instance.id,
      'work_order_invoice_timing'
    )
    check(
      'case13: new direct-created WO carries the new default timing',
      case13WoTiming?.optionId === 'on_completion',
      case13WoTiming?.optionId
    )

    const explicitQuote = await handler.create('quote', {
      quote_title: '[MI2-verify] Case13 explicit-timing quote',
      quote_contact: contactRecordId,
      quote_invoice_timing: 'per_visit_completed',
    })
    createdQuoteIds.push(explicitQuote.instance.id)
    await markQuoteSent({ organizationId, userId, quoteInstanceId: explicitQuote.instance.id })
    await approveQuote({ organizationId, userId, quoteInstanceId: explicitQuote.instance.id })
    const convertedWo = await convertQuoteToWorkOrder({
      organizationId,
      userId,
      quoteInstanceId: explicitQuote.instance.id,
    })
    createdWorkOrderIds.push(convertedWo.instance.id)
    const convertedWoTiming = await fieldValueByAttr(
      organizationId,
      'work_order',
      convertedWo.instance.id,
      'work_order_invoice_timing'
    )
    check(
      'case13: explicit quote timing wins over the org default at convert',
      convertedWoTiming?.optionId === 'per_visit_completed',
      convertedWoTiming?.optionId
    )

    await updateOrganizationSetting({
      organizationId,
      key: 'documents.invoice.defaultTiming',
      value: originalDefaultTiming as never,
    })
    await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })
    defaultTimingChanged = false

    // ══════════════════════════════════════════════════════════════════════
    // 14. Date basis (documents.invoice.dateBasis) — §O.4
    // ══════════════════════════════════════════════════════════════════════
    console.log('14: date basis (documents.invoice.dateBasis)')
    originalDateBasis = await getOrganizationSetting({
      organizationId,
      key: 'documents.invoice.dateBasis',
    })
    await updateOrganizationSetting({
      organizationId,
      key: 'documents.invoice.dateBasis',
      value: 'creation_date',
    })
    await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })
    dateBasisChanged = true

    const wo14 = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case14 creation_date basis',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(wo14.instance.id)
    const wo14Visit = (await getVisitsSorted(wo14.instance.id))[0]!
    const wo14FiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: wo14Visit.id,
      startTime: wo14FiveDaysAgo,
      endTime: new Date(wo14FiveDaysAgo.getTime() + 60 * 60_000),
    })
    const wo14Line = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case14 line',
      line_item_qty: 1,
      line_item_unit_price: 900,
      line_item_taxable: true,
      line_item_work_order: wo14.recordId,
      line_item_visit_id: wo14Visit.id,
    })
    createdLineIds.push(wo14Line.instance.id)
    await setVisitStatus({ organizationId, userId, visitId: wo14Visit.id, status: 'done' })
    const wo14Invoices = await listInvoicesFiltered('invoice:visitId', wo14Visit.id)
    check(
      'case14: creation_date basis generates a draft',
      wo14Invoices.length === 1,
      wo14Invoices.length
    )
    const wo14DraftId = wo14Invoices[0]!
    createdInvoiceIds.push(wo14DraftId)
    const wo14Owned = await listOwnedInvoiceLines(toRecordId('invoice', wo14DraftId))
    for (const id of wo14Owned) createdLineIds.push(id)
    const wo14IssuedAt = await fieldValueByAttr(
      organizationId,
      'invoice',
      wo14DraftId,
      'invoice_issued_at'
    )
    check(
      'case14: creation_date basis -> issuedAt = today, not the backdated visit date',
      String(wo14IssuedAt?.valueDate).slice(0, 10) === todayIso,
      { issuedAt: wo14IssuedAt?.valueDate, expected: todayIso }
    )

    // Restore to visit_date and re-verify the §9 backdate assertion holds.
    await updateOrganizationSetting({
      organizationId,
      key: 'documents.invoice.dateBasis',
      value: 'visit_date',
    })
    await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })

    const wo14b = await handler.create('work_order', {
      work_order_title: '[MI2-verify] Case14b visit_date basis',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(wo14b.instance.id)
    const wo14bVisit = (await getVisitsSorted(wo14b.instance.id))[0]!
    const wo14bThreeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: wo14bVisit.id,
      startTime: wo14bThreeDaysAgo,
      endTime: new Date(wo14bThreeDaysAgo.getTime() + 60 * 60_000),
    })
    const wo14bLine = await handler.create('line_item', {
      line_item_name: '[MI2-verify] Case14b line',
      line_item_qty: 1,
      line_item_unit_price: 700,
      line_item_taxable: true,
      line_item_work_order: wo14b.recordId,
      line_item_visit_id: wo14bVisit.id,
    })
    createdLineIds.push(wo14bLine.instance.id)
    await setVisitStatus({ organizationId, userId, visitId: wo14bVisit.id, status: 'done' })
    const wo14bInvoices = await listInvoicesFiltered('invoice:visitId', wo14bVisit.id)
    check(
      'case14b: visit_date basis (restored default) generates a draft',
      wo14bInvoices.length === 1,
      wo14bInvoices.length
    )
    const wo14bDraftId = wo14bInvoices[0]!
    createdInvoiceIds.push(wo14bDraftId)
    const wo14bOwned = await listOwnedInvoiceLines(toRecordId('invoice', wo14bDraftId))
    for (const id of wo14bOwned) createdLineIds.push(id)
    const wo14bIssuedAt = await fieldValueByAttr(
      organizationId,
      'invoice',
      wo14bDraftId,
      'invoice_issued_at'
    )
    const wo14bExpectedIso = wo14bThreeDaysAgo.toISOString().slice(0, 10)
    check(
      'case14b: visit_date basis -> issuedAt = backdated visit date (§9 assertion holds)',
      String(wo14bIssuedAt?.valueDate).slice(0, 10) === wo14bExpectedIso,
      { issuedAt: wo14bIssuedAt?.valueDate, expected: wo14bExpectedIso }
    )

    await updateOrganizationSetting({
      organizationId,
      key: 'documents.invoice.dateBasis',
      value: originalDateBasis as never,
    })
    await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })
    dateBasisChanged = false
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────
    console.log(
      `Cleanup: ${createdLineIds.length} lines, ${createdInvoiceIds.length} invoices, ` +
        `${createdWorkOrderIds.length} work orders, ${createdQuoteIds.length} quotes`
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

    if (autoEnabledChanged) {
      try {
        await updateOrganizationSetting({
          organizationId: 'u45w22ft66ymiaa19ohs7m9f',
          key: 'documents.invoice.autoEnabled',
          value: originalAutoEnabled as never,
        })
        await onCacheEvent('org.settings.changed', {
          orgId: 'u45w22ft66ymiaa19ohs7m9f',
          broadcastUserKeys: true,
        })
      } catch (err) {
        console.log(
          '  cleanup failed restoring documents.invoice.autoEnabled:',
          err instanceof Error ? err.message : err
        )
      }
    }
    if (defaultTimingChanged) {
      try {
        await updateOrganizationSetting({
          organizationId: 'u45w22ft66ymiaa19ohs7m9f',
          key: 'documents.invoice.defaultTiming',
          value: originalDefaultTiming as never,
        })
        await onCacheEvent('org.settings.changed', {
          orgId: 'u45w22ft66ymiaa19ohs7m9f',
          broadcastUserKeys: true,
        })
      } catch (err) {
        console.log(
          '  cleanup failed restoring documents.invoice.defaultTiming:',
          err instanceof Error ? err.message : err
        )
      }
    }
    if (dateBasisChanged) {
      try {
        await updateOrganizationSetting({
          organizationId: 'u45w22ft66ymiaa19ohs7m9f',
          key: 'documents.invoice.dateBasis',
          value: originalDateBasis as never,
        })
        await onCacheEvent('org.settings.changed', {
          orgId: 'u45w22ft66ymiaa19ohs7m9f',
          broadcastUserKeys: true,
        })
      } catch (err) {
        console.log(
          '  cleanup failed restoring documents.invoice.dateBasis:',
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
