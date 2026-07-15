// packages/lib/src/dispatch/visit-mutations.ts
//
// The single visit writer (01 §7, 07 §B.1). Every mutation: (1) write the row, (2) mirror
// onto the work order (§B.3), (3) apply the baked-in status roll-up (§B.2), (4) broadcast
// (§B.4) — steps 2–4 are the shared `afterVisitWrite` helper so the M2c engine's rolling-
// window materializer can reuse them after a bulk write. All mutations are org-scoped.

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { NotFoundError } from '../errors'
import { maybeGenerateVisitInvoiceDraft } from '../money/auto-invoice'
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
import type {
  AssignVisitInput,
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
    try {
      await enrollVisitScheduledSequences(organizationId, visitId)
    } catch (error) {
      logger.error('Failed to enroll visit:scheduled sequences', { error, visitId })
    }
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
 * (`startTime`/`endTime` → null). Resets the work order to `new`.
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

  const [updated] = await database
    .update(schema.WorkOrderVisit)
    // `durationMinutes` deliberately survives unscheduling (plan 20 §4.1a) — a backlog visit
    // keeps its duration intent for the next slot-in/apply; only the promise (`timeConfirmedAt`)
    // and the times themselves clear.
    .set({ startTime: null, endTime: null, timeConfirmedAt: null, updatedAt: new Date() })
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

  const [updated] = await database
    .update(schema.WorkOrderVisit)
    .set({ status, updatedAt: new Date() })
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
      await notifyVisitCanceled({ organizationId, userId, visit: updated })
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
