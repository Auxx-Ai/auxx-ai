// apps/web/src/components/dispatch/ui/route-planner/planner-dnd-provider.tsx

'use client'

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { AppDragOverlay } from '~/components/global/app-drag-overlay'
import { useRoutePlannerDragEnd } from './hooks/use-route-planner-mutations'
import type { PlannerBoard, PlannerDayWindow, RouteGeometry } from './types'

interface PlannerDndProviderProps {
  board: PlannerBoard
  window: PlannerDayWindow
  geometryByWorker: Record<string, RouteGeometry | undefined>
  children: React.ReactNode
}

/**
 * The route planner's `DndContext` (sidebar Backlog rows, sidebar Routes stop-list sortables,
 * worker-list droppables). Wraps the map mode's row in `dispatch-board.tsx`
 * (`DispatchSidebar` + `RoutePlannerView`, v3 sidebar plan §1.3) so both share one drag context —
 * calendar mode never mounts this provider at all, it mounts its own `CalendarDndProvider`
 * around the calendar branch's row instead (the two are mode-exclusive, never nested).
 */
export function PlannerDndProvider({
  board,
  window,
  geometryByWorker,
  children,
}: PlannerDndProviderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const handleDragEnd = useRoutePlannerDragEnd({ board, window, geometryByWorker })

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {children}
      <AppDragOverlay />
    </DndContext>
  )
}
