// packages/lib/src/dispatch/types.ts

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
