// packages/lib/src/dispatch/visit-mutations.ts
//
// The single visit writer (01 §7, 07 §B.1). Every mutation: (1) write the row, (2) mirror
// onto the work order (§B.3), (3) apply the baked-in status roll-up (§B.2), (4) broadcast
// (§B.4) — steps 2–4 are the shared `afterVisitWrite` helper so the M2c engine's rolling-
// window materializer can reuse them after a bulk write. All mutations are org-scoped.

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, NotFoundError } from '../errors'
import { maybeGenerateVisitInvoiceDraft } from '../money/auto-invoice'
import type { RecurrencePattern } from '../recurrence'
import {
  enrollVisitEnRouteSequences,
  enrollVisitScheduledSequences,
  exitVisitSequenceRuns,
  onVisitCompleted,
} from '../sequences/hooks'
import { reanchorSequenceRuns } from '../sequences/reanchor'
import { publishVisitChanged } from './broadcast'
import { type LifecycleTrigger, rollUpWorkOrderStatus } from './lifecycle'
import { mirrorVisitOntoWorkOrder } from './mirror'
// Direct module import (not the ./recurring barrel) — the barrel pulls engagement-actions,
// which imports this file back (the lib barrel-cycle gotcha).
import { getWorkOrderStatus, materializeVisits } from './recurring/materialize'
import type {
  AddVisitInput,
  AssignVisitInput,
  RestoreVisitInput,
  ScheduleVisitInput,
  SetVisitDurationInput,
  SetVisitStatusInput,
  UnscheduleVisitInput,
} from './types'
import {
  notifyVisitCanceled,
  notifyVisitReassigned,
  notifyVisitRescheduled,
} from './worker-notifications'

type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

const logger = createScopedLogger('dispatch:visit-mutations')

/**
 * Ensure exactly one `WorkOrderVisit` row exists for a work order. Idempotent by
 * construction — selects first, inserts only if absent. The 1:1 invariant (one visit per
 * work order, 01 §2) is service-enforced by this being the single creation door, not a DB
 * constraint. Inserted with `startTime: null` (unscheduled) — the board (M2) fills it in.
 *
 * @param organizationId - Organization the work order belongs to
 * @param workOrderInstanceId - EntityInstance id of the work order (not the RecordId)
 */
export async function ensureVisitForWorkOrder(
  organizationId: string,
  workOrderInstanceId: string
): Promise<void> {
  const existing = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.organizationId, organizationId),
      eq(schema.WorkOrderVisit.workOrderId, workOrderInstanceId)
    ),
  })
  if (existing) return

  await database.insert(schema.WorkOrderVisit).values({
    organizationId,
    workOrderId: workOrderInstanceId,
    status: 'scheduled',
    timezone: 'UTC',
    updatedAt: new Date(),
  })
}

/**
 * Steps 2–4 shared by every visit mutation (07 §B.1): mirror the visit onto the work
 * order's read-only fields, apply the baked-in one_off status roll-up (skipped when
 * `trigger` is omitted — e.g. `assignVisit`, which has no roll-up rule of its own), then
 * broadcast the change. Exported standalone so the M2c engine's rolling-window
 * materializer can reuse it after a bulk visit write.
 */
export async function afterVisitWrite(
  visit: WorkOrderVisitRow,
  opts: { userId: string; trigger?: LifecycleTrigger; excludeSocketId?: string }
): Promise<void> {
  await mirrorVisitOntoWorkOrder(visit.organizationId, opts.userId, visit.workOrderId)
  if (opts.trigger) {
    await rollUpWorkOrderStatus(visit.organizationId, opts.userId, visit.workOrderId, opts.trigger)
  }
  await publishVisitChanged(
    visit.organizationId,
    { visitId: visit.id, workOrderId: visit.workOrderId },
    { excludeSocketId: opts.excludeSocketId }
  )
}

/**
 * Client-notification enrollment shared by `scheduleVisit`'s canceled-revive path and
 * `restoreVisit` (plan 19 §4.3/§4.2, plan 30 §A.1): a one-off visit coming back from `canceled`
 * starts fresh reminders — recurring-born visits are the hourly sweep's job, never through here.
 * Failures must never fail the mutation that triggered them.
 */
async function enrollScheduledSequencesOnRevive(
  organizationId: string,
  visitId: string
): Promise<void> {
  try {
    await enrollVisitScheduledSequences(organizationId, visitId)
  } catch (error) {
    logger.error('Failed to enroll visit:scheduled sequences', { error, visitId })
  }
}

/**
 * Schedule (or reschedule) a visit — the single time/assignee writer. Rescheduling a canceled
 * visit explicitly revives it to `scheduled`; it never revives a `done` or in-progress visit.
 * Rolls the work order up to `scheduled`; the forward-only guard in `lifecycle.ts` makes
 * rescheduling an already-scheduled-or-later work order a no-op there, so this is safe to call
 * on every drag/drop and popover save alike.
 *
 * `timeWriteKind` (plan 20 §4.2, default `'confirmed'` — fails toward protecting times):
 * `'confirmed'` stamps `timeConfirmedAt` and, when the span is positive, syncs
 * `durationMinutes` from it; `'provisional'` (planner math — apply-times, slot-in) nulls
 * `timeConfirmedAt` and never touches `durationMinutes`.
 */
export async function scheduleVisit(input: ScheduleVisitInput): Promise<WorkOrderVisitRow> {
  const { organizationId, userId, visitId, startTime, endTime, timezone, excludeSocketId } = input

  // M2c (06 §4.3): load the row first so we know whether it's part of a series — a schedule
  // edit on a series visit is a "this visit" override (detach it; regeneration never touches
  // it again). `occurrenceDate` (slot identity) is never changed here.
  // Also carries startTime/endTime/dispatchedAt (plan 19 §4.9) — the only way to tell a
  // reschedule (already-scheduled visit, time actually changing) from first-time scheduling.
  const existing = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.id, visitId),
      eq(schema.WorkOrderVisit.organizationId, organizationId)
    ),
    columns: {
      recurrenceRuleId: true,
      startTime: true,
      endTime: true,
      dispatchedAt: true,
      status: true,
    },
  })
  if (!existing) throw new NotFoundError('Visit not found')

  const set: Partial<typeof schema.WorkOrderVisit.$inferInsert> = {
    startTime,
    endTime,
    updatedAt: new Date(),
  }
  if (input.assigneeUserId !== undefined) set.assigneeUserId = input.assigneeUserId
  if (timezone !== undefined) set.timezone = timezone
  if (existing.recurrenceRuleId) set.isDetached = true
  if (existing.status === 'canceled') set.status = 'scheduled'

  const kind = input.timeWriteKind ?? 'confirmed'
  if (kind === 'confirmed') {
    set.timeConfirmedAt = new Date()
    const spanMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60_000)
    if (spanMinutes > 0) set.durationMinutes = spanMinutes
  } else {
    set.timeConfirmedAt = null
  }

  const [updated] = await database
    .update(schema.WorkOrderVisit)
    .set(set)
    .where(
      and(
        eq(schema.WorkOrderVisit.id, visitId),
        eq(schema.WorkOrderVisit.organizationId, organizationId)
      )
    )
    .returning()
  if (!updated) throw new NotFoundError('Visit not found')

  await afterVisitWrite(updated, { userId, trigger: 'scheduled', excludeSocketId })

  // Worker-facing reschedule notice (plan 19 §4.9): only when a visit that was ALREADY
  // scheduled AND has been dispatched before has its time actually change — never on
  // first-time scheduling. Notification failures must never fail this mutation.
  if (
    existing.dispatchedAt &&
    existing.startTime &&
    existing.endTime &&
    (existing.startTime.getTime() !== startTime.getTime() ||
      existing.endTime.getTime() !== endTime.getTime())
  ) {
    try {
      await notifyVisitRescheduled({
        organizationId,
        userId,
        visit: updated,
        oldStartTime: existing.startTime,
        oldEndTime: existing.endTime,
      })
    } catch (error) {
      logger.error('Failed to notify visit rescheduled', { error, visitId })
    }
  }

  // Client-notification hooks (plan 19 §4.3/§4.2): enrollment is one-off only — recurring-born
  // visits are the hourly sweep's job (never through this function). A canceled one-off's active
  // runs were exited at cancellation, so explicitly rescheduling it starts fresh reminders.
  // Re-anchor fires on every other startTime change, one-off or a detached recurring occurrence.
  if (!existing.recurrenceRuleId && (!existing.startTime || existing.status === 'canceled')) {
    await enrollScheduledSequencesOnRevive(organizationId, visitId)
  } else if (existing.startTime && existing.startTime.getTime() !== startTime.getTime()) {
    try {
      await reanchorSequenceRuns(organizationId, 'visit', visitId, startTime)
    } catch (error) {
      logger.error('Failed to re-anchor sequence runs on reschedule', { error, visitId })
    }
  }

  return updated
}

/**
 * Restore a canceled visit to `scheduled` IN PLACE (plan 30 §A.1) — distinct from
 * `scheduleVisit`'s canceled-revive path, which restores to a NEW time. Leaves
 * `startTime`/`endTime`/`isDetached`/`occurrenceDate` untouched (a detached-then-skipped visit
 * restores to its overridden time, not the template slot) and clears `dispatchedAt` (it was
 * already cleared at cancel, §A.2 — this is belt-and-suspenders). Never sends a worker
 * notification — the visit comes back undispatched, "Dispatch" reads fresh again.
 *
 * With `resumeSeries` (plan 36 §A.2 — only legal on the series boundary visit, the occurrence
 * a "Skip this and future" ended the series at): also clears the rule pattern's `until` and
 * re-materializes the tail, making restore the symmetric undo of skip-future. Without it, the
 * restored visit stays the series' final occurrence.
 */
export async function restoreVisit(input: RestoreVisitInput): Promise<WorkOrderVisitRow> {
  const { organizationId, userId, visitId, resumeSeries, excludeSocketId } = input

  const existing = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.id, visitId),
      eq(schema.WorkOrderVisit.organizationId, organizationId)
    ),
  })
  if (!existing) throw new NotFoundError('Visit not found')
  if (existing.status !== 'canceled') {
    throw new BadRequestError('Only a canceled visit can be restored')
  }

  // Verify the boundary condition server-side before any write — the client should never
  // offer "resume" elsewhere, and a stale client must not clear an unrelated end date.
  let seriesRule: typeof schema.RecurrenceRule.$inferSelect | undefined
  if (resumeSeries) {
    if (!existing.recurrenceRuleId || !existing.occurrenceDate) {
      throw new BadRequestError('Visit is not part of a recurring series')
    }
    seriesRule = await database.query.RecurrenceRule.findFirst({
      where: and(
        eq(schema.RecurrenceRule.id, existing.recurrenceRuleId),
        eq(schema.RecurrenceRule.organizationId, organizationId)
      ),
    })
    if (!seriesRule) throw new NotFoundError('Recurrence rule not found')
    const pattern = seriesRule.pattern as unknown as RecurrencePattern
    if (pattern.until !== existing.occurrenceDate) {
      throw new BadRequestError('Visit is not the end of its series')
    }
    const status = await getWorkOrderStatus(organizationId, userId, existing.workOrderId)
    if (status === 'ended') {
      throw new BadRequestError('This engagement has ended — create a new job to schedule again')
    }
  }

  const [updated] = await database
    .update(schema.WorkOrderVisit)
    .set({ status: 'scheduled', dispatchedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.WorkOrderVisit.id, visitId),
        eq(schema.WorkOrderVisit.organizationId, organizationId)
      )
    )
    .returning()
  if (!updated) throw new NotFoundError('Visit not found')

  // Trigger 'scheduled' — same target `work_order_status` + forward-only guard as
  // `scheduleVisit` (lifecycle.ts): restoring a canceled visit is a forward move, never the
  // `canceled`/`unscheduled` reset.
  await afterVisitWrite(updated, { userId, trigger: 'scheduled', excludeSocketId })

  // Plan 36 §A.2 — resume: clear the pattern's `until` (back to open-ended; the pre-skip
  // value isn't stored anywhere) and regenerate the tail. A paused engagement only gets the
  // rule write — pause deleted the future rows and resume owns regeneration.
  if (resumeSeries && seriesRule) {
    const { until: _until, ...pattern } = seriesRule.pattern as unknown as RecurrencePattern
    const [updatedRule] = await database
      .update(schema.RecurrenceRule)
      .set({ pattern: pattern as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(schema.RecurrenceRule.id, seriesRule.id))
      .returning()
    const status = await getWorkOrderStatus(organizationId, userId, existing.workOrderId)
    if (updatedRule && status !== 'paused') {
      await materializeVisits(updatedRule, { userId, excludeSocketId })
    }
  }

  // Client-notification hooks (plan 19 §4.3): one-off only, mirrors the scheduleVisit revive.
  // Time-less restores (a canceled backlog row) skip enrollment — `visit:scheduled` means a
  // real null→set startTime transition, which a time-less restore isn't.
  if (!existing.recurrenceRuleId && existing.startTime) {
    await enrollScheduledSequencesOnRevive(organizationId, visitId)
  }

  return updated
}

/**
 * Create an extra unscheduled, rule-less visit on a work order (plan 30 §F.1) — e.g. extra
 * one-off work alongside a recurring engagement. ALWAYS inserts a new row (unlike
 * `ensureVisitForWorkOrder`, which is idempotent-by-selection); the 1:1 visit invariant is a
 * one-off-jobType invariant only (01 §10), and an explicit "Add visit" is a deliberate exception
 * to it even there.
 */
export async function addVisit(input: AddVisitInput): Promise<WorkOrderVisitRow> {
  const { organizationId, userId, workOrderInstanceId, startTime, endTime, assigneeUserId } = input
  const { excludeSocketId } = input

  const workOrder = await database.query.EntityInstance.findFirst({
    where: and(
      eq(schema.EntityInstance.id, workOrderInstanceId),
      eq(schema.EntityInstance.organizationId, organizationId)
    ),
    columns: { id: true },
  })
  if (!workOrder) throw new NotFoundError('Work order not found')

  const [created] = await database
    .insert(schema.WorkOrderVisit)
    .values({
      organizationId,
      workOrderId: workOrderInstanceId,
      status: 'scheduled',
      timezone: 'UTC',
      updatedAt: new Date(),
    })
    .returning()
  if (!created) throw new NotFoundError('Visit not found')

  // Schedule-picker create flow (plan 30 §F.2 follow-up): times picked in the draft popover
  // commit through `scheduleVisit` so the new row gets the full scheduling semantics —
  // `timeConfirmedAt`, mirror + roll-up, sequence enrollment, broadcast — in one tRPC call.
  if (startTime && endTime) {
    return scheduleVisit({
      organizationId,
      userId,
      visitId: created.id,
      startTime,
      endTime,
      assigneeUserId,
      excludeSocketId,
    })
  }

  await afterVisitWrite(created, { userId, excludeSocketId })

  return created
}

/**
 * Reassign a visit's worker without touching its schedule. No status roll-up rule of its
 * own (01 §5 lists no assign-specific transition) — mirror + broadcast only.
 */
export async function assignVisit(input: AssignVisitInput): Promise<WorkOrderVisitRow> {
  const { organizationId, userId, visitId, assigneeUserId, excludeSocketId } = input

  // M2c (06 §4.3): an assignee change on a series visit is also a "this visit" edit.
  // Also carries assigneeUserId/dispatchedAt (plan 19 §4.9) to detect a reassignment.
  const existing = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.id, visitId),
      eq(schema.WorkOrderVisit.organizationId, organizationId)
    ),
    columns: { recurrenceRuleId: true, assigneeUserId: true, dispatchedAt: true },
  })
  if (!existing) throw new NotFoundError('Visit not found')

  const set: Partial<typeof schema.WorkOrderVisit.$inferInsert> = {
    assigneeUserId,
    updatedAt: new Date(),
  }
  if (existing.recurrenceRuleId) set.isDetached = true

  const [updated] = await database
    .update(schema.WorkOrderVisit)
    .set(set)
    .where(
      and(
        eq(schema.WorkOrderVisit.id, visitId),
        eq(schema.WorkOrderVisit.organizationId, organizationId)
      )
    )
    .returning()
  if (!updated) throw new NotFoundError('Visit not found')

  await afterVisitWrite(updated, { userId, excludeSocketId })

  // Worker-facing reassignment notices (plan 19 §4.9): "removed" to the old assignee (if any)
  // + "assigned" to the new one (if any) — gated on the visit having ever been dispatched.
  // Notification failures must never fail this mutation.
  if (existing.dispatchedAt && existing.assigneeUserId !== assigneeUserId) {
    try {
      await notifyVisitReassigned({
        organizationId,
        userId,
        visit: updated,
        oldAssigneeUserId: existing.assigneeUserId,
      })
    } catch (error) {
      logger.error('Failed to notify visit reassigned', { error, visitId })
    }
  }

  return updated
}

/**
 * Clear a visit's schedule — back to the unassigned/unscheduled backlog rail
 * (`startTime`/`endTime` → null). Resets the work order to `new`. Series visits are
 * rejected (plan 30 decision 6): a recurrence occurrence never enters the backlog — its
 * exception verbs are Reschedule and Skip.
 */
export async function unscheduleVisit(input: UnscheduleVisitInput): Promise<WorkOrderVisitRow> {
  const { organizationId, userId, visitId, excludeSocketId } = input

  // Full pre-write row (plan 19 §4.9) — the "you don't need to go anymore" notice needs the
  // OLD startTime/endTime/assignee, which the update below nulls out.
  const existing = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.id, visitId),
      eq(schema.WorkOrderVisit.organizationId, organizationId)
    ),
  })
  if (!existing) throw new NotFoundError('Visit not found')
  if (existing.recurrenceRuleId) {
    throw new BadRequestError(
      'Recurring visits cannot be removed from the calendar — reschedule or skip this visit instead'
    )
  }

  const [updated] = await database
    .update(schema.WorkOrderVisit)
    // `durationMinutes` deliberately survives unscheduling (plan 20 §4.1a) — a backlog visit
    // keeps its duration intent for the next slot-in/apply; only the promise (`timeConfirmedAt`)
    // and the times themselves clear. `dispatchedAt` clears too (§A.2) — the worker was told
    // it's off; the cancel notice below still reads `existing`'s PRE-write value.
    .set({
      startTime: null,
      endTime: null,
      timeConfirmedAt: null,
      dispatchedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.WorkOrderVisit.id, visitId),
        eq(schema.WorkOrderVisit.organizationId, organizationId)
      )
    )
    .returning()
  if (!updated) throw new NotFoundError('Visit not found')

  await afterVisitWrite(updated, { userId, trigger: 'unscheduled', excludeSocketId })

  // Worker-facing cancel notice (plan 19 §4.9) — gated on `dispatchedAt` inside
  // `notifyVisitCanceled` itself. Notification failures must never fail this mutation.
  try {
    await notifyVisitCanceled({ organizationId, userId, visit: existing })
  } catch (error) {
    logger.error('Failed to notify visit unscheduled', { error, visitId })
  }

  // Client-notification exit (plan 19 §4.2/§4.10): an unscheduled visit's own sequence runs
  // (reminders/en-route/follow-up) have nothing left to do.
  try {
    await exitVisitSequenceRuns(organizationId, visitId, 'canceled')
  } catch (error) {
    logger.error('Failed to exit sequence runs on visit unschedule', { error, visitId })
  }

  return updated
}

/**
 * Set a visit's `durationMinutes` directly (plan 20 §4.1a) — the visit detail panel's explicit
 * duration field. Never touches `startTime`/`endTime`/`timeConfirmedAt`. No status roll-up rule
 * of its own (the `assignVisit` precedent) — mirror + broadcast only.
 */
export async function setVisitDuration(input: SetVisitDurationInput): Promise<WorkOrderVisitRow> {
  const { organizationId, userId, visitId, durationMinutes, excludeSocketId } = input

  // M2c (06 §4.3): a duration edit on a series visit is a "this visit" override too — without
  // the detach, the next rule regeneration deletes/recreates the row and the explicit duration
  // silently reverts to the template's.
  const existing = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.id, visitId),
      eq(schema.WorkOrderVisit.organizationId, organizationId)
    ),
    columns: { recurrenceRuleId: true },
  })
  if (!existing) throw new NotFoundError('Visit not found')

  const set: Partial<typeof schema.WorkOrderVisit.$inferInsert> = {
    durationMinutes,
    updatedAt: new Date(),
  }
  if (existing.recurrenceRuleId) set.isDetached = true

  const [updated] = await database
    .update(schema.WorkOrderVisit)
    .set(set)
    .where(
      and(
        eq(schema.WorkOrderVisit.id, visitId),
        eq(schema.WorkOrderVisit.organizationId, organizationId)
      )
    )
    .returning()
  if (!updated) throw new NotFoundError('Visit not found')

  await afterVisitWrite(updated, { userId, excludeSocketId })
  return updated
}

/**
 * Advance (or reset) a visit's own operational status
 * (`scheduled`/`en_route`/`on_site`/`done`/`canceled`); rolls up to the matching work order
 * status.
 */
export async function setVisitStatus(input: SetVisitStatusInput): Promise<WorkOrderVisitRow> {
  const { organizationId, userId, visitId, status, suppressRollUp, excludeSocketId } = input

  // §A.3 transition guard (30 §1 rec): loaded first so the same-status no-op and the
  // `done`/`canceled` terminal checks read the CURRENT status before anything is written.
  // Also doubles as the PRE-write row the cancel notice needs (§A.2 below).
  const existing = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.id, visitId),
      eq(schema.WorkOrderVisit.organizationId, organizationId)
    ),
  })
  if (!existing) throw new NotFoundError('Visit not found')

  if (existing.status === status) return existing
  if (existing.status === 'done') {
    throw new BadRequestError('Visit is already done')
  }
  if (existing.status === 'canceled') {
    throw new BadRequestError('Use Restore to bring back a canceled visit')
  }

  const set: Partial<typeof schema.WorkOrderVisit.$inferInsert> = { status, updatedAt: new Date() }
  // §A.2: cancel clears `dispatchedAt` (the worker was told it's off). The cancel notice below
  // reads `existing` (loaded before this write), not `updated`, so its own dispatchedAt gate
  // still sees the PRE-write value.
  if (status === 'canceled') set.dispatchedAt = null

  const [updated] = await database
    .update(schema.WorkOrderVisit)
    .set(set)
    .where(
      and(
        eq(schema.WorkOrderVisit.id, visitId),
        eq(schema.WorkOrderVisit.organizationId, organizationId)
      )
    )
    .returning()
  if (!updated) throw new NotFoundError('Visit not found')

  // 08 §6 "leave job open" close path: suppress the roll-up (omit `trigger`, the
  // `assignVisit` precedent) while still mirroring + broadcasting the visit write.
  await afterVisitWrite(updated, {
    userId,
    trigger: suppressRollUp ? undefined : status,
    excludeSocketId,
  })

  // Worker-facing cancel notice (plan 19 §4.9) — gated on `dispatchedAt` inside
  // `notifyVisitCanceled` itself. Notification failures must never fail this mutation.
  if (status === 'canceled') {
    try {
      await notifyVisitCanceled({ organizationId, userId, visit: existing })
    } catch (error) {
      logger.error('Failed to notify visit canceled', { error, visitId })
    }

    // Client-notification exit (plan 19 §4.2/§4.10): a canceled visit's own sequence runs have
    // nothing left to do.
    try {
      await exitVisitSequenceRuns(organizationId, visitId, 'canceled')
    } catch (error) {
      logger.error('Failed to exit sequence runs on visit cancellation', { error, visitId })
    }
  }

  // Client-notification enrollment (plan 19 §4.3): 'en_route'/'done' status transitions.
  if (status === 'en_route') {
    try {
      await enrollVisitEnRouteSequences(organizationId, visitId)
    } catch (error) {
      logger.error('Failed to enroll visit:en_route sequences', { error, visitId })
    }
  }
  if (status === 'done') {
    try {
      await onVisitCompleted(organizationId, visitId)
    } catch (error) {
      logger.error('Failed to enroll/exit sequences on visit completion', { error, visitId })
    }
  }

  // money MI2 build spec §D (Q1a) — per_visit_completed drafts generate synchronously here;
  // never let a billing failure fail the field tech's status tap.
  if (status === 'done') await maybeGenerateVisitInvoiceDraft(updated)

  return updated
}
