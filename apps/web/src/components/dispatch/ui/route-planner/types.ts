// apps/web/src/components/dispatch/ui/route-planner/types.ts
//
// Shared seam types for the route planner (09-route-planner.md, build contract "Seam contract
// (2A ↔ 2B)"). Written FIRST, exactly per the locked contract — both the map/chrome half (2A)
// and the panels/interactions half (2B) import from here, never redeclare these shapes.

import type { RouterOutputs } from '~/trpc/react'

export type PlannerBoard = RouterOutputs['dispatch']['getRoutePlannerBoard']
export type PlannerWorker = PlannerBoard['workers'][number]
export type PlannerVisit = PlannerBoard['visits'][number] // day visits, incl. unassigned
export type PlannerBacklogVisit = PlannerBoard['backlog'][number]
export type RouteGeometry = RouterOutputs['dispatch']['getRouteGeometry']

export interface PlannerFilters {
  /** `null` = every worker's route is drawn (the board's own `Set<userId> | null` convention). */
  workerIds: Set<string> | null
  /** `null` = every tag is visible. */
  tags: Set<string> | null
}

/** The planner's single-day window — client-computed (day windows are timezone-naive server-side). */
export interface PlannerDayWindow {
  from: Date
  to: Date
  dateKey: string
}
