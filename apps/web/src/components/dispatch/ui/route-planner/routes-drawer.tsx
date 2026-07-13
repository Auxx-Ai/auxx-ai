// apps/web/src/components/dispatch/ui/route-planner/routes-drawer.tsx

'use client'

import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { Route } from 'lucide-react'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { StopListPanel } from './stop-list-panel'
import type { PlannerBoard, PlannerDayWindow, PlannerFilters, RouteGeometry } from './types'

interface RoutesDrawerProps {
  board: PlannerBoard
  filters: PlannerFilters
  geometryByWorker: Record<string, RouteGeometry | undefined>
  date: PlannerDayWindow
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The route planner's stop lists in the standard drawer shell (`visit-drawer.tsx` pattern):
 * `DockableDrawer` + `DrawerHeader` with the dock toggle, global docked width. Reads dock state
 * itself; `dispatch-board.tsx` routes it into `MainPageContent`'s `dockedPanels` when docked, or
 * renders it as the overlay drawer when not. `overlay={false}` — the map behind must stay
 * pannable/clickable while the drawer is open (the default transparent overlay swallows every
 * background pointer event). Must render inside `PlannerDndProvider` (both homes do).
 */
export function RoutesDrawer({
  board,
  filters,
  geometryByWorker,
  date,
  open,
  onOpenChange,
}: RoutesDrawerProps) {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={dockedWidth}
      onWidthChange={setDockedWidth}
      minWidth={320}
      maxWidth={800}
      title='Routes'
      overlay={false}>
      <DrawerHeader
        icon={<Route className='size-4 text-muted-foreground' />}
        title='Routes'
        onClose={() => onOpenChange(false)}
        actions={<DockToggleButton />}
      />
      <StopListPanel
        board={board}
        filters={filters}
        geometryByWorker={geometryByWorker}
        date={date}
      />
    </DockableDrawer>
  )
}
