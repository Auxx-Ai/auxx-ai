// apps/web/src/components/dispatch/ui/board/types.ts
//
// Board-local types. `@auxx/lib/dispatch` has no `/client` export subpath (server-only
// deps), so the visit-status union is duplicated here rather than imported (the
// client-vs-server import rule in CLAUDE.md) — it mirrors `VISIT_STATUS_VALUES` in
// `packages/lib/src/dispatch/types.ts` (do not edit that file; this is a read-only mirror).

import type { EventCalendarItem } from '@auxx/ui/components/event-calendar'
import type { RouterOutputs } from '~/trpc/react'

export const VISIT_STATUS_VALUES = ['scheduled', 'en_route', 'on_site', 'done', 'canceled'] as const
export type VisitStatus = (typeof VISIT_STATUS_VALUES)[number]

/** The forward lifecycle order — used to compute "advance to next status". */
export const VISIT_STATUS_FORWARD_ORDER: VisitStatus[] = [
  'scheduled',
  'en_route',
  'on_site',
  'done',
]

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  scheduled: 'Scheduled',
  en_route: 'En route',
  on_site: 'On site',
  done: 'Done',
  canceled: 'Canceled',
}

export type BoardResult = RouterOutputs['dispatch']['getBoard']
export type BoardWorker = BoardResult['workers'][number]
export type BoardVisit = BoardResult['visits'][number]
export type BoardWorkOrder = BoardResult['workOrders'][number]

/** The unassigned column's synthetic resource id — maps to `assigneeUserId: null`. */
export const UNASSIGNED_RESOURCE_ID = 'unassigned'

/** A `WorkOrderVisit` row projected onto the calendar's event shape. */
export interface DispatchVisitEvent extends EventCalendarItem {
  workOrderId: string
  assigneeUserId: string | null
  status: VisitStatus
  dispatchedAt: string | null
  recurrenceRuleId: string | null
  workOrder: BoardWorkOrder | undefined
  /** Null = the event's `start`/`end` are provisional (planner math, never promised to a
   * human) — plan 20 §4.2/§4.3. Non-null = a deliberate human time-write or a customer-facing
   * send confirmed it. */
  timeConfirmedAt: string | null
  /** Intended on-site duration in minutes; null = no explicit intent (read-order falls back to
   * the scheduled span, then 60 — plan 20 §4.1a). */
  durationMinutes: number | null
}

export type BoardViewMode = 'day' | 'week' | 'month' | 'timeline'

/** Raw (JSX-free) resource-column data — `board-calendar-grid.tsx` builds the `header` node. */
export interface BoardResourceInput {
  id: string
  label: string
  color?: string
  worker?: BoardWorker
}

/**
 * Sidebar Backlog-group row data (v3 sidebar plan §1.2, ported from the deleted
 * `backlog-rail.tsx`). Kept structurally minimal (duck-typed) on purpose — the sidebar's
 * Backlog group renders both calendar mode's `BoardVisit`/`BoardWorkOrder` (`getBoard`) and map
 * mode's `PlannerVisit`/`PlannerBacklogVisit`/planner work orders (`getRoutePlannerBoard`); the
 * two tRPC outputs are structurally compatible for the fields actually rendered here, so this
 * type stays free of a `route-planner/types` import (board/types.ts has no reason to depend on
 * the planner).
 */
export interface BacklogItem {
  visit: { id: string; workOrderId: string; status: string }
  workOrder: { number: string | null; displayName: string | null } | undefined
}
