// packages/lib/src/dispatch/types.ts

import type { schema } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'

type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

/** Input for {@link createWorkOrderFromTicket} — the SECONDARY intake path (01 §8). */
export interface CreateFromTicketInput {
  organizationId: string
  userId: string
  /** EntityInstance id of the source ticket (not the RecordId). */
  ticketInstanceId: string
}

/** Input for {@link convertRequestToWorkOrder} — the PRIMARY intake path (01 §8/§9). */
export interface ConvertRequestToWorkOrderInput {
  organizationId: string
  userId: string
  /** EntityInstance id of the source service request (not the RecordId). */
  requestInstanceId: string
}

/** Input for {@link createWorkOrder} — the slot-click create flow (plan 37c §7): the board's
 * "New job" path, building a work order from nothing (not a conversion). */
export interface CreateWorkOrderInput {
  organizationId: string
  userId: string
  /** RecordId of the contact this job is for. */
  contactRecordId: RecordId
  /** Falls back to the contact's `EntityInstance.displayName` when omitted/blank. */
  title?: string
  startTime: Date
  endTime: Date
  assigneeUserId?: string | null
  excludeSocketId?: string
}

/** Output of {@link createWorkOrder}. */
export interface CreateWorkOrderResult {
  workOrderRecordId: RecordId
  visitId: string
  /** The scheduled visit row (plan 39 §Phase-1) — lets the acting-tab cache patch
   * (`applyVisitToCaches`) reconcile every visit-holding cache off this one response instead
   * of a second round trip. */
  visit: WorkOrderVisitRow
}

// ════════════════════════════════════════════════════════════════════════════
// Visit machinery (07-m2-build.md §B) — the M2 core.
// ════════════════════════════════════════════════════════════════════════════

/**
 * A visit's own operational status (01 §5) — distinct from `work_order_status`. Rolls up
 * onto the work order via `lifecycle.ts`.
 */
export const VISIT_STATUS_VALUES = ['scheduled', 'en_route', 'on_site', 'done', 'canceled'] as const
export type VisitStatus = (typeof VISIT_STATUS_VALUES)[number]

/** Input for {@link scheduleVisit} — the single time/assignee writer (07 §B.1). */
export interface ScheduleVisitInput {
  organizationId: string
  userId: string
  visitId: string
  startTime: Date
  endTime: Date
  /** Omit to leave the current assignee untouched; `null` explicitly unassigns. */
  assigneeUserId?: string | null
  timezone?: string
  /** Classification of this time-write (plan 20 §4.2): 'confirmed' (default) = a deliberate
   * human write — stamps `timeConfirmedAt` and syncs `durationMinutes` from the span;
   * 'provisional' = planner-computed (apply-times, map slot-in) — nulls `timeConfirmedAt`,
   * leaves `durationMinutes` untouched. */
  timeWriteKind?: 'provisional' | 'confirmed'
  /** Realtime echo-suppression — the acting client's own socket id (07 §B.4). */
  excludeSocketId?: string
}

/** Input for {@link assignVisit} — reassign without touching the schedule. */
export interface AssignVisitInput {
  organizationId: string
  userId: string
  visitId: string
  assigneeUserId: string | null
  excludeSocketId?: string
}

/** Input for {@link unscheduleVisit} — clears the schedule, back to the backlog rail. */
export interface UnscheduleVisitInput {
  organizationId: string
  userId: string
  visitId: string
  excludeSocketId?: string
}

/** Input for {@link setVisitStatus} — advance (or reset) a visit's operational status. */
export interface SetVisitStatusInput {
  organizationId: string
  userId: string
  visitId: string
  status: VisitStatus
  /** Skip the work-order status roll-up (worker "leave job open" close path, 08 §6). The
   * MI2 invoice-draft check still runs — org billing policy is independent of roll-up. */
  suppressRollUp?: boolean
  excludeSocketId?: string
}

/** Input for {@link dispatchVisit} — the separate notify action (07 §B.5). */
export interface DispatchVisitInput {
  organizationId: string
  userId: string
  visitId: string
  excludeSocketId?: string
}

/** Input for {@link restoreVisit} — bring a canceled visit back to `scheduled` in place
 * (plan 30 §A.1). Never touches `startTime`/`endTime`/`isDetached`/`occurrenceDate`. */
export interface RestoreVisitInput {
  organizationId: string
  userId: string
  visitId: string
  /**
   * Plan 36 §A.2 — also resume the series: only legal on the series' boundary visit (the
   * canceled occurrence whose `occurrenceDate` equals the rule pattern's `until`, i.e. the
   * visit a "Skip this and future" ended the series at). Clears the pattern's `until` and
   * re-materializes the tail (template occurrences only — overrides the skip deleted are
   * NOT resurrected).
   */
  resumeSeries?: boolean
  excludeSocketId?: string
}

/** Input for {@link addVisit} — create an extra rule-less visit on a work order (plan 30
 * §F.1), e.g. extra one-off work alongside a recurring engagement. When `startTime`/`endTime`
 * are provided (the schedule-picker create flow) the new row is scheduled in the same call via
 * {@link scheduleVisit}, so all scheduling side effects stay uniform; without times it lands
 * unscheduled. */
export interface AddVisitInput {
  organizationId: string
  userId: string
  /** EntityInstance id of the work order (not the RecordId). */
  workOrderInstanceId: string
  startTime?: Date | null
  endTime?: Date | null
  assigneeUserId?: string | null
  excludeSocketId?: string
}

/** Input for {@link setVisitDuration} — a standalone `durationMinutes` write (plan 20 §4.1a),
 * e.g. the visit detail panel's explicit duration field. Never touches `startTime`/`endTime`
 * or `timeConfirmedAt`. */
export interface SetVisitDurationInput {
  organizationId: string
  userId: string
  visitId: string
  durationMinutes: number | null
  excludeSocketId?: string
}

/**
 * Read-order for a visit's on-site duration (plan 20 §4.1a): explicit `durationMinutes` →
 * scheduled span → 60.
 */
export function resolveVisitDurationMinutes(visit: {
  durationMinutes?: number | null
  startTime?: Date | string | null
  endTime?: Date | string | null
}): number {
  if (visit.durationMinutes != null) return visit.durationMinutes

  if (visit.startTime && visit.endTime) {
    const start = new Date(visit.startTime).getTime()
    const end = new Date(visit.endTime).getTime()
    const spanMinutes = Math.round((end - start) / 60_000)
    if (spanMinutes > 0) return spanMinutes
  }

  return 60
}
