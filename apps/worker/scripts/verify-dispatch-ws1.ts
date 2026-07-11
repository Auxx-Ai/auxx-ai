// apps/worker/scripts/verify-dispatch-ws1.ts
/**
 * Dispatch WS1 "Worker Surface" backend verification
 * (plans/dispatch/08-worker-surface.md §7, ws1-contract.md). Exercises the REAL worker-scoped
 * read/write path added in WS1 1A: `packages/lib/src/dispatch/my-schedule.ts`'s four functions
 * (`listMyVisits`, `getMyVisitDetail`, `advanceMyVisit`, `closeMyVisit`) and
 * `packages/lib/src/recording/calendar/calendar-event-service.ts`'s two new functions
 * (`listMyMeetings`, `getMyMeeting`). Covers: the assignee guard (`loadOwnVisit`), the
 * money-hidden projections (no price/total/unitPrice keys ever reach this surface), the
 * `advanceMyVisit` transition matrix, and — the important one — the `closeMyVisit` close-chooser
 * matrix, including the MI2 collision: `leave_open` suppresses the work-order roll-up via
 * `setVisitStatus`'s `suppressRollUp` seam while `maybeGenerateVisitInvoiceDraft` still runs
 * independently, and `now` must not double-draft when the org's `per_visit_completed` auto-draft
 * already consumed the work order's uninvoiced lines.
 *
 * Work orders are created via `UnifiedCrudHandler.create` (the M1 number + visit auto-create
 * hooks), prefixed "[WS1-verify]". `WorkOrderVisit` rows cascade off `EntityInstance` deletes
 * (the `verify-dispatch-m2.ts`/`verify-dispatch-recurring.ts` precedent) but `line_item` and
 * `invoice` are separate `EntityInstance`s linked by relationship field, so they're deleted
 * explicitly first (the `verify-money-mi2.ts` precedent), then work orders, then the raw
 * `CalendarEvent`/`MeetingParticipant` rows this script inserts directly (no CRUD-handler
 * entity type backs those two tables).
 *
 * `assigneeUserId`/`CalendarEvent.userId`/`MeetingParticipant.userId` all carry FK constraints
 * to `User`, so the "different user" fixture must be a real row. The dev org
 * (`u45w22ft66ymiaa19ohs7m9f`, "Marki Corp") has exactly one member — the dev user — so this
 * script uses a real `User` row that belongs to NO organization (verified once at startup) as
 * the "stranger" — it can't disturb any org-scoped data because it isn't scoped to one.
 *
 * `apps/worker` has no direct `drizzle-orm` dependency (the `verify-dispatch-recurring.ts`
 * precedent) — reads use the `database.query.*` relational API (operators arrive as callback
 * args, no import needed) and the two raw-table deletes use `database.$client.query(...)`.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-dispatch-ws1.ts
 */

import { randomUUID } from 'node:crypto'
import { database, schema } from '@auxx/database'
import {
  advanceMyVisit,
  assignVisit,
  closeMyVisit,
  getMyVisitDetail,
  listMyVisits,
  scheduleVisit,
  setVisitStatus,
} from '@auxx/lib/dispatch'
import { BadRequestError, ForbiddenError, NotFoundError } from '@auxx/lib/errors'
import { getMyMeeting, listMyMeetings } from '@auxx/lib/recording/calendar'
import { UnifiedCrudHandler } from '@auxx/lib/resources'

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

/** Unwrap a `calendar-event-service.ts` `RecordingResult<T>` (a `neverthrow` `Result`), or throw. */
async function unwrap<T>(resultPromise: Promise<{ isErr(): boolean; error?: Error; value?: T }>) {
  const result = await resultPromise
  if (result.isErr()) throw result.error
  return result.value as T
}

/** True when `obj`'s own keys are all in `allowed` — the money-hidden shape check. */
function hasOnlyKeys(obj: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(obj).every((k) => allowed.includes(k))
}

// ── DB helpers (M2/MI2 script precedent) ──

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

async function woStatus(organizationId: string, workOrderInstanceId: string) {
  const fv = await fieldValueByAttr(
    organizationId,
    'work_order',
    workOrderInstanceId,
    'work_order_status'
  )
  return fv?.optionId ?? null
}

async function getVisitRow(visitId: string) {
  const visit = await database.query.WorkOrderVisit.findFirst({
    where: (t, { eq }) => eq(t.id, visitId),
  })
  if (!visit) throw new Error(`No visit row found for ${visitId}`)
  return visit
}

async function firstVisit(workOrderInstanceId: string) {
  const visit = await database.query.WorkOrderVisit.findFirst({
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
  })
  if (!visit) throw new Error(`No visit found for work order ${workOrderInstanceId}`)
  return visit
}

async function main() {
  const devUser = await database.query.User.findFirst({
    columns: { id: true, email: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!devUser) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — M2/MI2 precedent)
  const userId = devUser.id

  // Real `User` row belonging to NO organization — safe FK-satisfying "stranger" fixture (see
  // file header). Verified to exist so a stale hardcoded id fails loudly instead of silently
  // producing a bogus ForbiddenError check.
  const otherUserId = 'AOE6LhgqU5DMxA2oJlOC6xnfAGhnFeHM'
  const otherUser = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.id, otherUserId),
  })
  if (!otherUser) throw new Error(`Stranger fixture user ${otherUserId} not found`)
  console.log(`Org ${organizationId}, dev user ${userId}, stranger user ${otherUserId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)

  const contactDefId = await entityDefId(organizationId, 'contact')
  const contact = contactDefId
    ? await database.query.EntityInstance.findFirst({
        columns: { id: true, displayName: true },
        where: (t, { eq }) => eq(t.entityDefinitionId, contactDefId),
      })
    : null
  if (!contact) throw new Error('No contact in org — cannot test invoices')
  const contactRecordId = `${contactDefId}:${contact.id}` as never

  const createdWorkOrderIds: string[] = []
  const createdLineIds: string[] = []
  const createdInvoiceIds: string[] = []
  const createdCalendarEventIds: string[] = []
  const createdParticipantIds: string[] = []

  async function createWO(title: string, extra: Record<string, unknown> = {}) {
    const wo = await handler.create('work_order', {
      work_order_title: `[WS1-verify] ${title}`,
      ...extra,
    })
    createdWorkOrderIds.push(wo.instance.id)
    return wo
  }

  async function listInvoicesForWorkOrder(workOrderRecordId: unknown): Promise<string[]> {
    const { ids } = await handler.listFiltered({
      entityDefinitionId: 'invoice',
      filters: [
        {
          id: 'f',
          logicalOperator: 'AND',
          conditions: [
            { id: 'c1', fieldId: 'invoice:workOrder', operator: 'is', value: workOrderRecordId },
          ],
        },
      ],
      limit: 100,
      mode: 'oneshot',
    })
    return ids
  }

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. Assignee guard
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: assignee guard')
    const wo1 = await createWO('assignee guard', { work_order_contact: contactRecordId })
    const v1 = await firstVisit(wo1.instance.id)
    await assignVisit({ organizationId, userId, visitId: v1.id, assigneeUserId: userId })

    const detailForbidden = await expectThrow(() =>
      getMyVisitDetail({ organizationId, userId: otherUserId, visitId: v1.id })
    )
    check(
      'getMyVisitDetail throws ForbiddenError for a visit assigned to a different user',
      detailForbidden instanceof ForbiddenError,
      detailForbidden
    )

    const advanceForbidden = await expectThrow(() =>
      advanceMyVisit({ organizationId, userId: otherUserId, visitId: v1.id, to: 'en_route' })
    )
    check(
      'advanceMyVisit throws ForbiddenError for a visit assigned to a different user',
      advanceForbidden instanceof ForbiddenError,
      advanceForbidden
    )

    const closeForbidden = await expectThrow(() =>
      closeMyVisit({ organizationId, userId: otherUserId, visitId: v1.id, invoice: 'later' })
    )
    check(
      'closeMyVisit throws ForbiddenError for a visit assigned to a different user',
      closeForbidden instanceof ForbiddenError,
      closeForbidden
    )

    const detailNotFound = await expectThrow(() =>
      getMyVisitDetail({ organizationId, userId, visitId: 'nonexistent-visit-id-000000' })
    )
    check(
      'getMyVisitDetail throws NotFoundError for a non-existent visit',
      detailNotFound instanceof NotFoundError,
      detailNotFound
    )
    const advanceNotFound = await expectThrow(() =>
      advanceMyVisit({
        organizationId,
        userId,
        visitId: 'nonexistent-visit-id-000000',
        to: 'en_route',
      })
    )
    check(
      'advanceMyVisit throws NotFoundError for a non-existent visit',
      advanceNotFound instanceof NotFoundError,
      advanceNotFound
    )
    const closeNotFound = await expectThrow(() =>
      closeMyVisit({
        organizationId,
        userId,
        visitId: 'nonexistent-visit-id-000000',
        invoice: 'later',
      })
    )
    check(
      'closeMyVisit throws NotFoundError for a non-existent visit',
      closeNotFound instanceof NotFoundError,
      closeNotFound
    )

    const ownedDetail = await getMyVisitDetail({ organizationId, userId, visitId: v1.id })
    check('getMyVisitDetail succeeds for the owner', ownedDetail.id === v1.id, ownedDetail)
    const advanced = await advanceMyVisit({
      organizationId,
      userId,
      visitId: v1.id,
      to: 'en_route',
    })
    check(
      'advanceMyVisit succeeds for the owner (scheduled->en_route)',
      advanced.status === 'en_route',
      advanced.status
    )

    // ══════════════════════════════════════════════════════════════════════
    // 2. listMyVisits — window filter, cross-user exclusion, ordering, no prices
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: listMyVisits')
    const now = new Date()
    const winFrom = now
    const winTo = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

    const woLaterInWindow = await createWO('listMyVisits later-in-window')
    const vLaterInWindow = await firstVisit(woLaterInWindow.instance.id)
    const laterStart = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
    await assignVisit({
      organizationId,
      userId,
      visitId: vLaterInWindow.id,
      assigneeUserId: userId,
    })
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vLaterInWindow.id,
      startTime: laterStart,
      endTime: new Date(laterStart.getTime() + 60 * 60 * 1000),
    })

    const woSoonerInWindow = await createWO('listMyVisits sooner-in-window')
    const vSoonerInWindow = await firstVisit(woSoonerInWindow.instance.id)
    const soonerStart = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
    await assignVisit({
      organizationId,
      userId,
      visitId: vSoonerInWindow.id,
      assigneeUserId: userId,
    })
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vSoonerInWindow.id,
      startTime: soonerStart,
      endTime: new Date(soonerStart.getTime() + 60 * 60 * 1000),
    })

    const woOtherUser = await createWO('listMyVisits other-user')
    const vOtherUser = await firstVisit(woOtherUser.instance.id)
    await assignVisit({
      organizationId,
      userId,
      visitId: vOtherUser.id,
      assigneeUserId: otherUserId,
    })
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vOtherUser.id,
      startTime: new Date(now.getTime() + 1.5 * 24 * 60 * 60 * 1000),
      endTime: new Date(now.getTime() + 1.5 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
    })

    const woOutOfRange = await createWO('listMyVisits out-of-range')
    const vOutOfRange = await firstVisit(woOutOfRange.instance.id)
    await assignVisit({ organizationId, userId, visitId: vOutOfRange.id, assigneeUserId: userId })
    const outOfRangeStart = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vOutOfRange.id,
      startTime: outOfRangeStart,
      endTime: new Date(outOfRangeStart.getTime() + 60 * 60 * 1000),
    })

    const myVisits = await listMyVisits({ organizationId, userId, from: winFrom, to: winTo })
    const myVisitIds = myVisits.map((v) => v.id)
    check(
      'listMyVisits returns exactly the caller-owned in-window visits (sooner, later)',
      myVisitIds.length === 2 &&
        myVisitIds.includes(vSoonerInWindow.id) &&
        myVisitIds.includes(vLaterInWindow.id),
      myVisitIds
    )
    check('listMyVisits excludes another user’s visit', !myVisitIds.includes(vOtherUser.id))
    check('listMyVisits excludes an out-of-range visit', !myVisitIds.includes(vOutOfRange.id))
    check(
      'listMyVisits orders by startTime asc',
      myVisits[0]?.id === vSoonerInWindow.id && myVisits[1]?.id === vLaterInWindow.id,
      myVisits.map((v) => [v.id, v.startTime])
    )
    check(
      'listMyVisits items carry NO price fields (slim shape only)',
      myVisits.every(
        (v) =>
          hasOnlyKeys(v as unknown as Record<string, unknown>, [
            'id',
            'status',
            'startTime',
            'endTime',
            'timezone',
            'workOrder',
          ]) &&
          hasOnlyKeys(v.workOrder as unknown as Record<string, unknown>, [
            'id',
            'displayName',
            'number',
          ])
      ),
      myVisits
    )

    // ══════════════════════════════════════════════════════════════════════
    // 3. getMyVisitDetail — full payload + money-hidden lines
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: getMyVisitDetail payload')
    const wo3 = await createWO('detail payload', {
      work_order_contact: contactRecordId,
      work_order_description: 'Fix the broken pipe under the sink',
      work_order_address: {
        street1: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'US',
      },
    })
    const v3 = await firstVisit(wo3.instance.id)
    await assignVisit({ organizationId, userId, visitId: v3.id, assigneeUserId: userId })

    const line3a = await handler.create('line_item', {
      line_item_name: '[WS1-verify] Detail line A',
      line_item_qty: 2,
      line_item_description: 'Copper fitting',
      line_item_unit_price: 4500,
      line_item_taxable: true,
      line_item_work_order: wo3.recordId,
    })
    createdLineIds.push(line3a.instance.id)
    const line3b = await handler.create('line_item', {
      line_item_name: '[WS1-verify] Detail line B',
      line_item_qty: 1,
      line_item_unit_price: 1000,
      line_item_taxable: true,
      line_item_work_order: wo3.recordId,
    })
    createdLineIds.push(line3b.instance.id)

    const detail3 = await getMyVisitDetail({ organizationId, userId, visitId: v3.id })
    check(
      'getMyVisitDetail: workOrder.number carries a WO- number',
      !!detail3.workOrder.number?.startsWith('WO-'),
      detail3.workOrder.number
    )
    check(
      'getMyVisitDetail: workOrder.instructions = description text',
      detail3.workOrder.instructions === 'Fix the broken pipe under the sink',
      detail3.workOrder.instructions
    )
    check(
      'getMyVisitDetail: workOrder.contactDisplayName matches the contact',
      detail3.workOrder.contactDisplayName === contact.displayName,
      { got: detail3.workOrder.contactDisplayName, expected: contact.displayName }
    )
    check(
      'getMyVisitDetail: workOrder.serviceAddress formats the address struct',
      !!detail3.workOrder.serviceAddress &&
        detail3.workOrder.serviceAddress.includes('123 Main St') &&
        detail3.workOrder.serviceAddress.includes('Austin') &&
        detail3.workOrder.serviceAddress.includes('78701'),
      detail3.workOrder.serviceAddress
    )
    check(
      'getMyVisitDetail: workOrder object carries ONLY the contracted keys (no price fields)',
      hasOnlyKeys(detail3.workOrder as unknown as Record<string, unknown>, [
        'id',
        'displayName',
        'number',
        'instructions',
        'contactDisplayName',
        'serviceAddress',
      ]),
      Object.keys(detail3.workOrder)
    )
    check('getMyVisitDetail: exactly 2 lines returned', detail3.lines.length === 2, detail3.lines)
    check(
      'getMyVisitDetail: lines carry ONLY name/quantity/description — no price/total/unitPrice',
      detail3.lines.every((l) =>
        hasOnlyKeys(l as unknown as Record<string, unknown>, ['name', 'quantity', 'description'])
      ),
      detail3.lines
    )
    const lineA = detail3.lines.find((l) => l.name === '[WS1-verify] Detail line A')
    check(
      'getMyVisitDetail: line qty/description read correctly',
      lineA?.quantity === 2 && lineA?.description === 'Copper fitting',
      lineA
    )

    // ══════════════════════════════════════════════════════════════════════
    // 4. advanceMyVisit transition matrix
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: advanceMyVisit transition matrix')
    const wo4 = await createWO('advance matrix')
    const v4 = await firstVisit(wo4.instance.id)
    await assignVisit({ organizationId, userId, visitId: v4.id, assigneeUserId: userId })

    const rejectOnSite = await expectThrow(() =>
      advanceMyVisit({ organizationId, userId, visitId: v4.id, to: 'on_site' })
    )
    check('reject: scheduled->on_site', rejectOnSite instanceof BadRequestError, rejectOnSite)
    const rejectDone = await expectThrow(() =>
      advanceMyVisit({ organizationId, userId, visitId: v4.id, to: 'done' })
    )
    check('reject: scheduled->done', rejectDone instanceof BadRequestError, rejectDone)

    const step1 = await advanceMyVisit({ organizationId, userId, visitId: v4.id, to: 'en_route' })
    check('allow: scheduled->en_route', step1.status === 'en_route', step1.status)
    check(
      'allow: scheduled->en_route delegates to setVisitStatus (WO rolls up to en_route)',
      (await woStatus(organizationId, wo4.instance.id)) === 'en_route'
    )

    const rejectEnRouteDone = await expectThrow(() =>
      advanceMyVisit({ organizationId, userId, visitId: v4.id, to: 'done' })
    )
    check('reject: en_route->done', rejectEnRouteDone instanceof BadRequestError, rejectEnRouteDone)

    const step2 = await advanceMyVisit({ organizationId, userId, visitId: v4.id, to: 'on_site' })
    check('allow: en_route->on_site', step2.status === 'on_site', step2.status)
    check(
      'allow: en_route->on_site delegates to setVisitStatus (WO rolls up to on_site)',
      (await woStatus(organizationId, wo4.instance.id)) === 'on_site'
    )

    const undo1 = await advanceMyVisit({ organizationId, userId, visitId: v4.id, to: 'en_route' })
    check('allow (undo): on_site->en_route', undo1.status === 'en_route', undo1.status)
    check(
      'undo does not roll the WO status backward (forward-only guard, stays on_site)',
      (await woStatus(organizationId, wo4.instance.id)) === 'on_site'
    )

    const undo2 = await advanceMyVisit({ organizationId, userId, visitId: v4.id, to: 'scheduled' })
    check('allow (undo): en_route->scheduled', undo2.status === 'scheduled', undo2.status)

    const rejectScheduledScheduled = await expectThrow(() =>
      advanceMyVisit({ organizationId, userId, visitId: v4.id, to: 'scheduled' })
    )
    check(
      'reject: scheduled->scheduled (not a listed transition)',
      rejectScheduledScheduled instanceof BadRequestError,
      rejectScheduledScheduled
    )

    // done -> anything is rejected (advance directly via setVisitStatus to reach 'done', since
    // advanceMyVisit itself can never produce 'done' — that's closeMyVisit's job).
    const wo4b = await createWO('advance matrix done-guard')
    const v4b = await firstVisit(wo4b.instance.id)
    await assignVisit({ organizationId, userId, visitId: v4b.id, assigneeUserId: userId })
    await setVisitStatus({ organizationId, userId, visitId: v4b.id, status: 'done' })
    const rejectDoneEnRoute = await expectThrow(() =>
      advanceMyVisit({ organizationId, userId, visitId: v4b.id, to: 'en_route' })
    )
    check('reject: done->en_route', rejectDoneEnRoute instanceof BadRequestError, rejectDoneEnRoute)

    // ══════════════════════════════════════════════════════════════════════
    // 5. closeMyVisit matrix — the MI2 collision resolution
    // ══════════════════════════════════════════════════════════════════════
    console.log('5a: leave_open suppresses roll-up; later rolls up')
    const wo5a = await createWO('close leave_open', {
      work_order_contact: contactRecordId,
      work_order_invoice_timing: 'as_needed', // no auto-draft door matches — isolates this case
    })
    const v5a = await firstVisit(wo5a.instance.id)
    await assignVisit({ organizationId, userId, visitId: v5a.id, assigneeUserId: userId })
    const statusBeforeLeaveOpen = await woStatus(organizationId, wo5a.instance.id)
    const closeLeaveOpen = await closeMyVisit({
      organizationId,
      userId,
      visitId: v5a.id,
      invoice: 'leave_open',
    })
    check('leave_open: returns invoiced:false', closeLeaveOpen.invoiced === false, closeLeaveOpen)
    const visit5aAfter = await getVisitRow(v5a.id)
    check('leave_open: visit status -> done', visit5aAfter.status === 'done', visit5aAfter.status)
    check(
      'leave_open: work-order roll-up is SUPPRESSED (status unchanged, not completed)',
      (await woStatus(organizationId, wo5a.instance.id)) === statusBeforeLeaveOpen,
      { before: statusBeforeLeaveOpen, after: await woStatus(organizationId, wo5a.instance.id) }
    )

    const wo5aLater = await createWO('close later', {
      work_order_contact: contactRecordId,
      work_order_invoice_timing: 'as_needed',
    })
    const v5aLater = await firstVisit(wo5aLater.instance.id)
    await assignVisit({ organizationId, userId, visitId: v5aLater.id, assigneeUserId: userId })
    const closeLater = await closeMyVisit({
      organizationId,
      userId,
      visitId: v5aLater.id,
      invoice: 'later',
    })
    check('later: returns invoiced:false', closeLater.invoiced === false, closeLater)
    const visit5aLaterAfter = await getVisitRow(v5aLater.id)
    check('later: visit status -> done', visit5aLaterAfter.status === 'done')
    check(
      'later (contrast with leave_open): work-order roll-up DOES fire (status -> completed)',
      (await woStatus(organizationId, wo5aLater.instance.id)) === 'completed',
      await woStatus(organizationId, wo5aLater.instance.id)
    )

    console.log('5b: now — contact + uninvoiced lines + timing != per_visit_completed')
    const wo5b = await createWO('close now manual gather', {
      work_order_contact: contactRecordId,
      work_order_invoice_timing: 'as_needed',
    })
    const v5b = await firstVisit(wo5b.instance.id)
    await assignVisit({ organizationId, userId, visitId: v5b.id, assigneeUserId: userId })
    const line5b = await handler.create('line_item', {
      line_item_name: '[WS1-verify] Case5b line',
      line_item_qty: 1,
      line_item_unit_price: 2000,
      line_item_taxable: true,
      line_item_work_order: wo5b.recordId,
    })
    createdLineIds.push(line5b.instance.id)
    const close5b = await closeMyVisit({ organizationId, userId, visitId: v5b.id, invoice: 'now' })
    check(
      'now (manual gather): returns invoiced:true, no error',
      close5b.invoiced === true && close5b.invoiceError === undefined,
      close5b
    )
    const invoices5b = await listInvoicesForWorkOrder(wo5b.recordId)
    check(
      'now (manual gather): exactly ONE invoice created for the work order',
      invoices5b.length === 1,
      invoices5b
    )
    for (const id of invoices5b) createdInvoiceIds.push(id)
    const owned5bLine = await fieldValueByAttr(
      organizationId,
      'line_item',
      line5b.instance.id,
      'line_item_invoice'
    )
    check(
      'now (manual gather): the uninvoiced line got stamped onto the new invoice',
      !!owned5bLine?.relatedEntityId
    )
    // Track the invoice's own owned (copied) line for cleanup.
    const invoice5bLines = await handler.listFiltered({
      entityDefinitionId: 'line_item',
      filters: [
        {
          id: 'f',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'c1',
              fieldId: 'line_item:invoice',
              operator: 'is',
              value: `invoice:${invoices5b[0]}`,
            },
          ],
        },
      ],
      limit: 100,
      mode: 'oneshot',
    })
    for (const id of invoice5bLines.ids) createdLineIds.push(id)

    console.log('5c: now — per_visit_completed already consumed the lines (no double-draft)')
    const wo5c = await createWO('close now dedup', {
      work_order_contact: contactRecordId,
      work_order_invoice_timing: 'per_visit_completed',
    })
    const v5c = await firstVisit(wo5c.instance.id)
    await assignVisit({ organizationId, userId, visitId: v5c.id, assigneeUserId: userId })
    const line5c = await handler.create('line_item', {
      line_item_name: '[WS1-verify] Case5c line',
      line_item_qty: 1,
      line_item_unit_price: 3000,
      line_item_taxable: true,
      line_item_work_order: wo5c.recordId,
      line_item_visit_id: v5c.id,
    })
    createdLineIds.push(line5c.instance.id)
    const close5c = await closeMyVisit({ organizationId, userId, visitId: v5c.id, invoice: 'now' })
    check(
      'now (dedup): returns invoiced:true (the per_visit auto-draft already covered it)',
      close5c.invoiced === true && close5c.invoiceError === undefined,
      close5c
    )
    const invoices5c = await listInvoicesForWorkOrder(wo5c.recordId)
    check(
      'now (dedup): exactly ONE invoice exists — no duplicate empty draft from closeMyVisit',
      invoices5c.length === 1,
      invoices5c
    )
    for (const id of invoices5c) createdInvoiceIds.push(id)
    const invoice5cLines = await handler.listFiltered({
      entityDefinitionId: 'line_item',
      filters: [
        {
          id: 'f',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'c1',
              fieldId: 'line_item:invoice',
              operator: 'is',
              value: `invoice:${invoices5c[0]}`,
            },
          ],
        },
      ],
      limit: 100,
      mode: 'oneshot',
    })
    for (const id of invoice5cLines.ids) createdLineIds.push(id)

    console.log('5d: now — no contact on the work order (soft no_contact, never throws)')
    const wo5d = await createWO('close now no-contact', {
      work_order_invoice_timing: 'as_needed',
    })
    const v5d = await firstVisit(wo5d.instance.id)
    await assignVisit({ organizationId, userId, visitId: v5d.id, assigneeUserId: userId })
    const line5d = await handler.create('line_item', {
      line_item_name: '[WS1-verify] Case5d line',
      line_item_qty: 1,
      line_item_unit_price: 1500,
      line_item_taxable: true,
      line_item_work_order: wo5d.recordId,
    })
    createdLineIds.push(line5d.instance.id)
    const close5dErr = await expectThrow(() =>
      closeMyVisit({ organizationId, userId, visitId: v5d.id, invoice: 'now' })
    )
    check('now (no-contact): does NOT throw', close5dErr === undefined, close5dErr)
    const close5d = await closeMyVisit({ organizationId, userId, visitId: v5d.id, invoice: 'now' })
    check(
      'now (no-contact): returns {invoiced:false, invoiceError:"no_contact"}',
      close5d.invoiced === false && close5d.invoiceError === 'no_contact',
      close5d
    )
    const invoices5d = await listInvoicesForWorkOrder(wo5d.recordId)
    check('now (no-contact): no invoice created', invoices5d.length === 0, invoices5d)
    const visit5dAfter = await getVisitRow(v5d.id)
    check(
      'now (no-contact): visit still completes despite the soft billing failure',
      visit5dAfter.status === 'done',
      visit5dAfter.status
    )

    // ══════════════════════════════════════════════════════════════════════
    // 6/7. listMyMeetings / getMyMeeting
    // ══════════════════════════════════════════════════════════════════════
    console.log('6/7: listMyMeetings + getMyMeeting')
    const meetWinFrom = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)
    const meetWinTo = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)
    const inWindowStart = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)

    async function insertCalendarEvent(opts: {
      title: string
      ownerUserId: string
      startTime: Date
    }) {
      const [row] = await database
        .insert(schema.CalendarEvent)
        .values({
          organizationId,
          userId: opts.ownerUserId,
          provider: 'google',
          externalId: `ws1-verify-${randomUUID()}`,
          title: opts.title,
          startTime: opts.startTime,
          endTime: new Date(opts.startTime.getTime() + 30 * 60 * 1000),
          timezone: 'UTC',
          organizer: { email: 'organizer@example.com', name: 'Organizer' },
          attendees: [],
          syncedAt: new Date(),
        })
        .returning()
      if (!row) throw new Error('Failed to insert CalendarEvent fixture')
      createdCalendarEventIds.push(row.id)
      return row
    }

    async function insertParticipant(opts: {
      calendarEventId: string
      participantUserId?: string
      name: string
      email: string
      isOrganizer?: boolean
      rsvpStatus?: 'accepted' | 'declined' | 'tentative' | 'needs_action'
    }) {
      const [row] = await database
        .insert(schema.MeetingParticipant)
        .values({
          organizationId,
          meetingId: contact.id, // FK-satisfying placeholder EntityInstance — see file header
          calendarEventId: opts.calendarEventId,
          userId: opts.participantUserId ?? null,
          name: opts.name,
          email: opts.email,
          emailDomain: opts.email.split('@')[1] ?? 'example.com',
          isOrganizer: opts.isOrganizer ?? false,
          rsvpStatus: opts.rsvpStatus ?? 'needs_action',
        })
        .returning()
      if (!row) throw new Error('Failed to insert MeetingParticipant fixture')
      createdParticipantIds.push(row.id)
      return row
    }

    const meetingOwned = await insertCalendarEvent({
      title: '[WS1-verify] owned meeting',
      ownerUserId: userId,
      startTime: inWindowStart,
    })

    const meetingParticipant = await insertCalendarEvent({
      title: '[WS1-verify] participant meeting',
      ownerUserId: otherUserId,
      startTime: new Date(inWindowStart.getTime() + 60 * 60 * 1000),
    })
    await insertParticipant({
      calendarEventId: meetingParticipant.id,
      participantUserId: userId,
      name: 'Dev Worker',
      email: 'dev-worker@example.com',
    })
    await insertParticipant({
      calendarEventId: meetingParticipant.id,
      name: 'Jane Client',
      email: 'jane@client.com',
      isOrganizer: true,
      rsvpStatus: 'accepted',
    })

    const meetingStranger = await insertCalendarEvent({
      title: '[WS1-verify] stranger meeting',
      ownerUserId: otherUserId,
      startTime: new Date(inWindowStart.getTime() + 2 * 60 * 60 * 1000),
    })

    const meetingOutOfRange = await insertCalendarEvent({
      title: '[WS1-verify] out-of-range owned meeting',
      ownerUserId: userId,
      startTime: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    })

    const myMeetings = await unwrap(
      listMyMeetings({ organizationId, userId, from: meetWinFrom, to: meetWinTo })
    )
    const myMeetingIds = myMeetings.map((m) => m.id)
    check(
      'listMyMeetings includes an owned meeting',
      myMeetingIds.includes(meetingOwned.id),
      myMeetingIds
    )
    check(
      'listMyMeetings includes a meeting the user only PARTICIPATES in (union)',
      myMeetingIds.includes(meetingParticipant.id),
      myMeetingIds
    )
    check(
      'listMyMeetings excludes a meeting the user neither owns nor participates in',
      !myMeetingIds.includes(meetingStranger.id)
    )
    check(
      'listMyMeetings excludes an out-of-range owned meeting',
      !myMeetingIds.includes(meetingOutOfRange.id)
    )
    check(
      'listMyMeetings dedups (each id appears at most once)',
      new Set(myMeetingIds).size === myMeetingIds.length,
      myMeetingIds
    )

    const detailOwned = await unwrap(
      getMyMeeting({ organizationId, userId, meetingId: meetingOwned.id })
    )
    check(
      'getMyMeeting returns the event for the owner',
      detailOwned !== null && detailOwned.id === meetingOwned.id,
      detailOwned
    )

    const detailParticipant = await unwrap(
      getMyMeeting({ organizationId, userId, meetingId: meetingParticipant.id })
    )
    check(
      'getMyMeeting returns the event for a participant (non-owner)',
      detailParticipant !== null && detailParticipant.id === meetingParticipant.id,
      detailParticipant
    )
    check(
      'getMyMeeting attendees carry the resolved participant rows',
      detailParticipant?.attendees.length === 2 &&
        detailParticipant.attendees.some((a) => a.email === 'dev-worker@example.com') &&
        detailParticipant.attendees.some((a) => a.email === 'jane@client.com' && a.isOrganizer),
      detailParticipant?.attendees
    )

    const detailStranger = await unwrap(
      getMyMeeting({ organizationId, userId, meetingId: meetingStranger.id })
    )
    check(
      'getMyMeeting returns null for a meeting the user neither owns nor participates in',
      detailStranger === null,
      detailStranger
    )
  } finally {
    // ── Cleanup (MI2 precedent: lines/invoices before work orders) ──
    console.log(
      `Cleanup: ${createdLineIds.length} lines, ${createdInvoiceIds.length} invoices, ` +
        `${createdWorkOrderIds.length} work orders, ${createdParticipantIds.length} participants, ` +
        `${createdCalendarEventIds.length} calendar events`
    )
    for (const id of [...new Set(createdLineIds)]) {
      try {
        await handler.delete(`line_item:${id}` as never)
      } catch (err) {
        console.log(
          `  cleanup failed for line_item:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of [...new Set(createdInvoiceIds)]) {
      try {
        await handler.delete(`invoice:${id}` as never)
      } catch (err) {
        console.log(`  cleanup failed for invoice:${id}:`, err instanceof Error ? err.message : err)
      }
    }
    for (const id of [...new Set(createdWorkOrderIds)]) {
      try {
        await handler.delete(`work_order:${id}` as never)
      } catch (err) {
        console.log(
          `  cleanup failed for work_order:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of [...new Set(createdParticipantIds)]) {
      try {
        await database.$client.query('DELETE FROM "MeetingParticipant" WHERE id = $1', [id])
      } catch (err) {
        console.log(
          `  cleanup failed for MeetingParticipant ${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of [...new Set(createdCalendarEventIds)]) {
      try {
        await database.$client.query('DELETE FROM "CalendarEvent" WHERE id = $1', [id])
      } catch (err) {
        console.log(
          `  cleanup failed for CalendarEvent ${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
