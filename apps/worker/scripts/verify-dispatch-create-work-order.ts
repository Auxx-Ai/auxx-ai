// apps/worker/scripts/verify-dispatch-create-work-order.ts
/**
 * `createWorkOrder` verification (plans/dispatch/37c-calendar-create-copy-paste.md §7/§9 Phase
 * 5). Exercises the REAL write path `createWorkOrder`
 * (packages/lib/src/dispatch/create-work-order.ts) — the §2.5-corrected mechanism where
 * `handler.create('work_order', ...)` does NOT itself schedule anything; a field-change hook
 * (`ensureVisitOnWorkOrderCreate`, keyed off the first `work_order_number` write) auto-creates
 * one UNSCHEDULED visit synchronously inside that call, and `createWorkOrder` has to look that
 * row up (it isn't returned) before `scheduleVisit`-ing it with the slot's times/assignee. This
 * script's job is checking that hand-off, not `scheduleVisit`/`handler.create` themselves:
 *
 * - The work order lands with the right title and a contact link; `work_order_status` rolls up
 *   to `'scheduled'` (not `'new'`) because `createWorkOrder` schedules the visit in the same call.
 * - Exactly ONE visit exists on the new work order (the hook's row, found and scheduled in
 *   place — never a second stray insert) and it carries the given times + assignee.
 * - Title omitted/blank → falls back to the contact's `EntityInstance.displayName`.
 * - `assigneeUserId` omitted → the visit lands unassigned (`null`), same as every other
 *   fresh-row contract in this codebase (`addVisit`/`pasteVisits`).
 *
 * Work orders + their contacts are created via `UnifiedCrudHandler.create` (M1 hooks), prefixed
 * "[create-wo-verify]", and deleted at the end — `WorkOrderVisit.workOrderId` cascades on
 * `EntityInstance` delete (the `verify-dispatch-paste-visits.ts` precedent). No
 * dispatch/notification/money path is touched (fresh rows never carry a prior `dispatchedAt`),
 * so no queue pausing is needed.
 *
 * Timing: the dev org has no `OperatingHours` row so the org resolves to 'UTC' (asserted as a
 * precondition, the `verify-dispatch-series-end.ts`/`verify-dispatch-paste-visits.ts`
 * precedent); all times here are plain UTC.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-dispatch-create-work-order.ts
 */

import { database } from '@auxx/database'
import { getOrgCache } from '@auxx/lib/cache'
import { createWorkOrder } from '@auxx/lib/dispatch'
import { UnifiedCrudHandler } from '@auxx/lib/resources'

/** Pulls the EntityInstance id back out of a `entityDefId:entityInstanceId` RecordId string
 * without pulling in `@auxx/types` (not a worker dependency — the `verify-money-*.ts`
 * precedent). */
function instanceIdOf(recordId: string): string {
  return recordId.split(':')[1]!
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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function addDaysToIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return isoDate(d)
}
/** A UTC start/end pair `daysFromNow` at a fixed hour, `durationMinutes` long. */
function slot(daysFromNow: number, hour: number, durationMinutes = 60) {
  const start = new Date(`${addDaysToIso(isoDate(new Date()), daysFromNow)}T00:00:00.000Z`)
  start.setUTCHours(hour, 0, 0, 0)
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  return { startTime: start, endTime: end }
}

async function getVisitsSorted(workOrderInstanceId: string) {
  return database.query.WorkOrderVisit.findMany({
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
    orderBy: (t, { asc }) => [asc(t.startTime)],
  })
}

/** Reads the `work_order_contact` relationship value back off the created work order — a raw
 * `FieldValue` row read (`relatedEntityId` is the RELATIONSHIP storage column) rather than the
 * `FieldValueService`/`getFieldValues` route, so this script doesn't need `@auxx/types`'
 * `TypedFieldValue` shape (not a worker dependency — the `verify-money-*.ts` precedent). */
async function getContactLinkInstanceId(
  organizationId: string,
  workOrderInstanceId: string
): Promise<string | undefined> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['work_order_contact'] as const)
  if (!cf.work_order_contact) return undefined
  const row = await database.query.FieldValue.findFirst({
    where: (t, { and, eq }) =>
      and(
        eq(t.organizationId, organizationId),
        eq(t.entityId, workOrderInstanceId),
        eq(t.fieldId, cf.work_order_contact!.id)
      ),
    columns: { relatedEntityId: true },
  })
  return row?.relatedEntityId ?? undefined
}

/** Reads `work_order_status` back (the SINGLE_SELECT `optionId` storage column) — confirms the
 * create landed at the expected `'new'`. */
async function getStatus(
  organizationId: string,
  workOrderInstanceId: string
): Promise<string | undefined> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['work_order_status'] as const)
  if (!cf.work_order_status) return undefined
  const row = await database.query.FieldValue.findFirst({
    where: (t, { and, eq }) =>
      and(
        eq(t.organizationId, organizationId),
        eq(t.entityId, workOrderInstanceId),
        eq(t.fieldId, cf.work_order_status!.id)
      ),
    columns: { optionId: true },
  })
  return row?.optionId ?? undefined
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

  const opHours = await database.query.OperatingHours.findFirst({
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.subjectType, 'organization')),
    columns: { timezone: true },
  })
  if (opHours?.timezone && opHours.timezone !== 'UTC') {
    throw new Error(`Expected dev org timezone 'UTC', got '${opHours.timezone}'`)
  }

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const createdRecordIds: string[] = []

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. Full create: explicit title + assignee — WO fields, contact link, exactly ONE
    //    visit, scheduled with the given times/assignee.
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: full create — explicit title + assignee')
    const contact1 = await handler.create('contact', {
      first_name: '[create-wo-verify]',
      last_name: 'ContactOne',
    })
    createdRecordIds.push(contact1.recordId)

    const item1 = slot(5, 9)
    const result1 = await createWorkOrder({
      organizationId,
      userId,
      contactRecordId: contact1.recordId,
      title: '[create-wo-verify] custom job title',
      startTime: item1.startTime,
      endTime: item1.endTime,
      assigneeUserId: userId,
    })
    createdRecordIds.push(result1.workOrderRecordId)

    const wo1InstanceId = instanceIdOf(result1.workOrderRecordId)
    const wo1Instance = await database.query.EntityInstance.findFirst({
      where: (t, { and, eq }) => and(eq(t.id, wo1InstanceId), eq(t.organizationId, organizationId)),
      columns: { displayName: true },
    })
    check(
      'work order title matches the given title',
      wo1Instance?.displayName === '[create-wo-verify] custom job title',
      wo1Instance?.displayName
    )
    // `handler.create` lands `work_order_status: 'new'`, but `createWorkOrder` immediately
    // `scheduleVisit`s the hook-created visit in the same call — `scheduleVisit`'s own roll-up
    // (`lifecycle.ts`'s forward-only guard, trigger `'scheduled'`) advances the work order to
    // `'scheduled'` right away, same as every other schedule action (drag from backlog, etc.).
    // A slot-click create never observably rests at `'new'`.
    check(
      'work order status rolls up to "scheduled" (the visit was scheduled in the same call)',
      (await getStatus(organizationId, wo1InstanceId)) === 'scheduled'
    )
    check(
      'work order contact link points at the given contact',
      (await getContactLinkInstanceId(organizationId, wo1InstanceId)) === contact1.instance.id
    )

    const visits1 = await getVisitsSorted(wo1InstanceId)
    check('exactly ONE visit exists on the new work order', visits1.length === 1, visits1.length)
    const visit1 = visits1[0]
    check('the returned visitId matches the actual row', visit1?.id === result1.visitId)
    check(
      'visit is scheduled with the given times',
      visit1?.startTime?.getTime() === item1.startTime.getTime() &&
        visit1?.endTime?.getTime() === item1.endTime.getTime(),
      visit1
    )
    check('visit status is "scheduled"', visit1?.status === 'scheduled')
    check('visit assignee matches the given userId', visit1?.assigneeUserId === userId)
    check(
      'visit is rule-less (a from-scratch job, never a series)',
      visit1?.recurrenceRuleId === null && visit1?.occurrenceDate === null
    )

    // ══════════════════════════════════════════════════════════════════════
    // 2. Title omitted → falls back to the contact's displayName.
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: title omitted → falls back to contact displayName')
    const contact2 = await handler.create('contact', {
      first_name: '[create-wo-verify]',
      last_name: 'FallbackTitle',
    })
    createdRecordIds.push(contact2.recordId)
    const contact2Instance = await database.query.EntityInstance.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.id, contact2.instance.id), eq(t.organizationId, organizationId)),
      columns: { displayName: true },
    })
    check(
      'setup: contact has a populated displayName',
      typeof contact2Instance?.displayName === 'string' && contact2Instance.displayName.length > 0,
      contact2Instance?.displayName
    )

    const item2 = slot(6, 10)
    const result2 = await createWorkOrder({
      organizationId,
      userId,
      contactRecordId: contact2.recordId,
      startTime: item2.startTime,
      endTime: item2.endTime,
    })
    createdRecordIds.push(result2.workOrderRecordId)

    const wo2InstanceId = instanceIdOf(result2.workOrderRecordId)
    const wo2Instance = await database.query.EntityInstance.findFirst({
      where: (t, { and, eq }) => and(eq(t.id, wo2InstanceId), eq(t.organizationId, organizationId)),
      columns: { displayName: true },
    })
    check(
      'work order title falls back to the contact displayName',
      wo2Instance?.displayName === contact2Instance?.displayName,
      { woTitle: wo2Instance?.displayName, contactDisplayName: contact2Instance?.displayName }
    )
    const visits2 = await getVisitsSorted(wo2InstanceId)
    check('exactly ONE visit exists', visits2.length === 1, visits2.length)

    // Blank (whitespace-only) title is treated the same as omitted.
    console.log('2b: blank title also falls back to contact displayName')
    const item2b = slot(6, 13)
    const result2b = await createWorkOrder({
      organizationId,
      userId,
      contactRecordId: contact2.recordId,
      title: '   ',
      startTime: item2b.startTime,
      endTime: item2b.endTime,
    })
    createdRecordIds.push(result2b.workOrderRecordId)
    const wo2bInstance = await database.query.EntityInstance.findFirst({
      where: (t, { and, eq }) =>
        and(
          eq(t.id, instanceIdOf(result2b.workOrderRecordId)),
          eq(t.organizationId, organizationId)
        ),
      columns: { displayName: true },
    })
    check(
      'blank title falls back to the contact displayName too',
      wo2bInstance?.displayName === contact2Instance?.displayName,
      wo2bInstance?.displayName
    )

    // ══════════════════════════════════════════════════════════════════════
    // 3. assigneeUserId omitted → the visit lands unassigned.
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: assigneeUserId omitted → unassigned')
    const contact3 = await handler.create('contact', {
      first_name: '[create-wo-verify]',
      last_name: 'Unassigned',
    })
    createdRecordIds.push(contact3.recordId)

    const item3 = slot(7, 14)
    const result3 = await createWorkOrder({
      organizationId,
      userId,
      contactRecordId: contact3.recordId,
      title: '[create-wo-verify] unassigned job',
      startTime: item3.startTime,
      endTime: item3.endTime,
      // assigneeUserId intentionally omitted
    })
    createdRecordIds.push(result3.workOrderRecordId)

    const wo3InstanceId = instanceIdOf(result3.workOrderRecordId)
    const visits3 = await getVisitsSorted(wo3InstanceId)
    check('exactly ONE visit exists', visits3.length === 1, visits3.length)
    check(
      'omitted assigneeUserId: visit lands unassigned',
      visits3[0]?.assigneeUserId === null,
      visits3[0]?.assigneeUserId
    )
    check(
      'visit still carries the given times despite no assignee',
      visits3[0]?.startTime?.getTime() === item3.startTime.getTime() &&
        visits3[0]?.endTime?.getTime() === item3.endTime.getTime()
    )
  } finally {
    console.log(`Cleanup: deleting ${createdRecordIds.length} verify records`)
    for (const recordId of createdRecordIds.reverse()) {
      try {
        await handler.delete(recordId as never)
      } catch (err) {
        console.log(`  cleanup failed for ${recordId}:`, err instanceof Error ? err.message : err)
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
