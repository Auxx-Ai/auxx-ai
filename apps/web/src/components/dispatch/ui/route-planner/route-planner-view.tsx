// apps/web/src/components/dispatch/ui/route-planner/route-planner-view.tsx

'use client'

import { useState } from 'react'
import { BacklogPane } from './backlog-pane'
import { PlannerMap } from './planner-map'
import type { PlannerBoard, PlannerDayWindow, PlannerFilters, RouteGeometry } from './types'

interface RoutePlannerViewProps {
  board: PlannerBoard
  window: PlannerDayWindow
  geometryByWorker: Record<string, RouteGeometry | undefined>
  filters: PlannerFilters
  isLoading: boolean
  /** Panel visibility lives in `use-board-data.ts` — the board toolbar owns the toggle. */
  showBacklog: boolean
}

/**
 * Route planner map surface (09-route-planner.md §A/§E, restyled): a full-bleed `PlannerMap`
 * with the `BacklogPane` floating over its left edge (translucent + `backdrop-blur-sm`) — no
 * header of its own; panel toggles moved to `BoardToolbar`. The stop lists are NOT here: they
 * live in `routes-drawer.tsx`, mounted by `dispatch-board.tsx` (overlay drawer or docked
 * `MainPageContent` panel), and the shared drag context is `planner-dnd-provider.tsx`, mounted
 * ABOVE `MainPageContent` so backlog↔stop-list drags reach both homes. All planner surfaces
 * share the one `board`/`filters`/`geometryByWorker` read (`use-route-planner-data.ts`, owned
 * by `dispatch-board.tsx` since the toolbar's tag filter needs the same distinct-tags list).
 *
 * `ApplyTimesDialog` isn't rendered here even though it's a 2B component that appears in this
 * tree — `StopListPanel`'s `WorkerStopSection` already owns a per-worker instance of it
 * (its "Apply times" button lives there per the design doc's own file split). A second,
 * view-level trigger would just be a confusing duplicate entry point to the same write.
 */
export function RoutePlannerView({
  board,
  window,
  geometryByWorker,
  filters,
  isLoading,
  showBacklog,
}: RoutePlannerViewProps) {
  const [focusedVisitId, setFocusedVisitId] = useState<string | null>(null)

  // `focusedVisitId` is threaded to the map for a future pan/highlight-on-hover affordance
  // (design doc §E) — kept as local state here since 2B's `PinPopoverContent` reads its own
  // `visit` prop directly and doesn't need this value.
  void focusedVisitId

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

      {showBacklog && (
        <div className='bg-background/70 absolute inset-y-0 left-0 z-10 border-r backdrop-blur-sm'>
          <BacklogPane board={board} filters={filters} onFocusVisit={setFocusedVisitId} />
        </div>
      )}
    </div>
  )
}
