// apps/web/src/components/dispatch/ui/route-planner/route-planner-view.tsx

'use client'

import { PlannerMap } from './planner-map'
import type { PlannerBoard, PlannerDayWindow, PlannerFilters, RouteGeometry } from './types'

interface RoutePlannerViewProps {
  board: PlannerBoard
  window: PlannerDayWindow
  geometryByWorker: Record<string, RouteGeometry | undefined>
  filters: PlannerFilters
  isLoading: boolean
}

/**
 * Route planner map surface (09-route-planner.md §A/§E, restyled by the v3 module-sidebar
 * plan): a full-bleed `PlannerMap`, no header/panels of its own. The Backlog and Routes
 * (stop-list) surfaces that used to float/dock here now live in the one `DispatchSidebar`
 * (`dispatch/ui/sidebar/`), mounted as this component's sibling by `dispatch-board.tsx` — both
 * share the same `board`/`filters`/`geometryByWorker` read (`use-route-planner-data.ts`, owned
 * by `dispatch-board.tsx`) and the same `PlannerDndProvider` drag context.
 */
export function RoutePlannerView({
  board,
  window,
  geometryByWorker,
  filters,
  isLoading,
}: RoutePlannerViewProps) {
  return (
    <div className='relative min-h-0 flex-1 overflow-hidden'>
      <PlannerMap
        board={board}
        filters={filters}
        geometryByWorker={geometryByWorker}
        window={window}
      />

      {isLoading && (
        <div className='bg-background/80 text-muted-foreground absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-md px-2 py-1 text-xs backdrop-blur-sm'>
          Loading…
        </div>
      )}
    </div>
  )
}
