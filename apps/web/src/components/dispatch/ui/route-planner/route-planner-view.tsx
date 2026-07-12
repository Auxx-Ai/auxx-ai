// apps/web/src/components/dispatch/ui/route-planner/route-planner-view.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { PanelLeft, PanelRight } from 'lucide-react'
import { useState } from 'react'
import { BacklogPane } from './backlog-pane'
import { useRoutePlannerDragEnd } from './hooks/use-route-planner-mutations'
import { PlannerMap } from './planner-map'
import { StopListPanel } from './stop-list-panel'
import type { PlannerBoard, PlannerDayWindow, PlannerFilters, RouteGeometry } from './types'

interface RoutePlannerViewProps {
  board: PlannerBoard
  window: PlannerDayWindow
  geometryByWorker: Record<string, RouteGeometry | undefined>
  filters: PlannerFilters
  isLoading: boolean
}

/**
 * Route planner three-pane layout (09-route-planner.md §A/§H): left `BacklogPane`, center
 * `PlannerMap`, right `StopListPanel` — all sharing this one `board`/`filters`/`geometryByWorker`
 * read (`use-route-planner-data.ts`, owned by `dispatch-board.tsx` since the toolbar's tag
 * filter needs the same distinct-tags list). Mounts its OWN `DndContext` — backlog rows and
 * stop-list rows register against it, independent of the board's `CalendarDndProvider` (which
 * stays mounted around this component in calendar↔map toggling, but plays no part here).
 *
 * `ApplyTimesDialog` isn't rendered here even though it's a 2B component that appears in this
 * tree — `StopListPanel`'s `WorkerStopSection` already owns a per-worker instance of it
 * (its "Apply times" button lives there per the design doc's own file split). A second,
 * view-level trigger would just be a confusing duplicate entry point to the same write.
 *
 * Panels collapse to an absolutely-positioned overlay under `md` so the map stays full-bleed on
 * phone widths; the toggle buttons stay reachable at every width.
 */
export function RoutePlannerView({
  board,
  window,
  geometryByWorker,
  filters,
  isLoading,
}: RoutePlannerViewProps) {
  const [showBacklog, setShowBacklog] = useState(true)
  const [showStopList, setShowStopList] = useState(true)
  const [focusedVisitId, setFocusedVisitId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const handleDragEnd = useRoutePlannerDragEnd({ board, window, geometryByWorker })

  // `focusedVisitId` is threaded to the map for a future pan/highlight-on-hover affordance
  // (design doc §E) — kept as local state here since 2B's `PinPopoverContent` reads its own
  // `visit` prop directly and doesn't need this value.
  void focusedVisitId

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className='flex h-full flex-1 flex-col overflow-hidden'>
        <div className='flex items-center gap-2 border-b p-2'>
          <Button variant='outline' size='sm' onClick={() => setShowBacklog((v) => !v)}>
            <PanelLeft />
          </Button>
          <div className='flex-1' />
          {isLoading && <span className='text-muted-foreground text-xs'>Loading…</span>}
          <Button variant='outline' size='sm' onClick={() => setShowStopList((v) => !v)}>
            <PanelRight />
          </Button>
        </div>

        <div className='relative flex flex-1 overflow-hidden'>
          {showBacklog && (
            <div className='absolute inset-y-0 left-0 z-10 bg-background md:relative md:z-0'>
              <BacklogPane board={board} filters={filters} onFocusVisit={setFocusedVisitId} />
            </div>
          )}

          <div className='relative min-w-0 flex-1'>
            <PlannerMap
              board={board}
              filters={filters}
              geometryByWorker={geometryByWorker}
              window={window}
            />
          </div>

          {showStopList && (
            <div className='absolute inset-y-0 right-0 z-10 bg-background md:relative md:z-0'>
              <StopListPanel
                board={board}
                filters={filters}
                geometryByWorker={geometryByWorker}
                date={window}
              />
            </div>
          )}
        </div>
      </div>
    </DndContext>
  )
}
