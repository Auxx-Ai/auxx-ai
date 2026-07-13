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
import { useRoutePlannerDragEnd } from './hooks/use-route-planner-mutations'
import type { PlannerBoard, PlannerDayWindow, RouteGeometry } from './types'

interface PlannerDndProviderProps {
  board: PlannerBoard
  window: PlannerDayWindow
  geometryByWorker: Record<string, RouteGeometry | undefined>
  children: React.ReactNode
}

/**
 * The route planner's `DndContext` (backlog rows, stop-list sortables, worker-list droppables).
 * Lives ABOVE `MainPageContent` in `dispatch-board.tsx` — NOT inside `RoutePlannerView` — so the
 * Routes panel keeps its drag context in BOTH homes: the overlay `RoutesDrawer` (portaled, React
 * context flows through portals) and the docked `MainPageContent` panel (a sibling of the board,
 * unreachable from any provider mounted inside it). Calendar mode mounts `CalendarDndProvider`
 * INSIDE this one, so calendar draggables still bind to their own nearest context.
 */
export function PlannerDndProvider({
  board,
  window,
  geometryByWorker,
  children,
}: PlannerDndProviderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const handleDragEnd = useRoutePlannerDragEnd({ board, window, geometryByWorker })

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {children}
    </DndContext>
  )
}
