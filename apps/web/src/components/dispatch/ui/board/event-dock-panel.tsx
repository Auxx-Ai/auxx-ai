// apps/web/src/components/dispatch/ui/board/event-dock-panel.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { DockPanel } from '@auxx/ui/components/dock-panel'
import { EventPopoverBody } from '@auxx/ui/components/event-calendar'
import { useEffect } from 'react'
import { useDispatchSidebarStore } from '../../stores/dispatch-sidebar-store'
import type { ExistingVisitForOverlap } from '../schedule-popover'
import { EventDockGuide } from './event-dock-guide'
import type { useBoardMutations } from './hooks/use-board-mutations'
import type { DispatchVisitEvent } from './types'
import { VisitPopoverContent } from './visit-popover'

interface EventDockPanelProps {
  /** The selected event (`data.events` looked up by `activeVisitId`), or `null` when nothing
   * is selected — renders `EventDockGuide` in that case. */
  event: DispatchVisitEvent | null
  onActiveVisitChange: (visitId: string | null) => void
  canEdit: boolean
  mutations: ReturnType<typeof useBoardMutations>
  existingVisits: ExistingVisitForOverlap[]
  onOpenRecord: (recordId: RecordId, drill?: { panel?: string; item?: string }) => void
}

/**
 * Dispatch's consumer of the general `@auxx/ui` `DockPanel` primitive (plan 21, "Dispatch
 * wiring"). Once docked (decision #3, sticky mode) every event click swaps this panel's body
 * instead of opening the floating `EventPopover` — `board-calendar-grid.tsx` suppresses that
 * popover via `isDockOpen`. Body reuses `VisitPopoverContent` verbatim inside `EventPopoverBody`
 * (`fill` mode), which provides the series-scope gate + `CommandNavigation` drill stack its
 * sections require. Empty selection ('empty' `contentKey`) shows `EventDockGuide`.
 */
export function EventDockPanel({
  event,
  onActiveVisitChange,
  canEdit,
  mutations,
  existingVisits,
  onOpenRecord,
}: EventDockPanelProps) {
  const dock = useDispatchSidebarStore((s) => s.eventDock)
  const setEventDockOpen = useDispatchSidebarStore((s) => s.setEventDockOpen)
  const setEventDockSide = useDispatchSidebarStore((s) => s.setEventDockSide)

  // Esc clears the selection (→ guide state) while docked with an event selected. A plain
  // window listener rather than fighting existing dialog/popover Esc handling — nothing else
  // owns Esc here since the floating `EventPopover`/its `Popover` primitive isn't mounted in
  // dock mode (board-calendar-grid.tsx renders a plain click target instead).
  useEffect(() => {
    if (!dock.open || !event) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onActiveVisitChange(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dock.open, event, onActiveVisitChange])

  return (
    <DockPanel
      open={dock.open}
      side={dock.side}
      contentKey={event?.id ?? 'empty'}
      onClose={() => {
        setEventDockOpen(false)
        onActiveVisitChange(null)
      }}
      onPopOut={() => setEventDockOpen(false)}
      onFlipSide={setEventDockSide}>
      {event ? (
        /* `VisitPopoverContent`'s sections need the full `EventPopoverBody` wrapper — the
         * series-scope gate (`useSeriesScope`) AND the `CommandNavigation` drill stack
         * (`useCommandNavigation` in `EventDateTimeSection` et al.) both throw without it.
         * `fill` stretches it to the column instead of the popover's 40rem max-height cap. */
        <EventPopoverBody
          fill
          series={{
            isMember: Boolean(event.recurrenceRuleId),
            labels: { this: 'This visit', following: 'This and following', all: 'All visits' },
          }}>
          <VisitPopoverContent
            event={event}
            canEdit={canEdit}
            mutations={mutations}
            existingVisits={existingVisits}
            // In dock mode `onClose` is only fired by the record-opening link handlers to
            // dismiss the *floating* popover before the drawer opens. The dock is sticky
            // (plan 21 decision #3) — keep the event selected so opening a work order/contact
            // doesn't clear `activeVisitId` and drop the panel back to the guide. Real
            // dismissal goes through `DockPanel`'s own `onClose` (X / Esc).
            onClose={() => {}}
            onOpenRecord={onOpenRecord}
          />
        </EventPopoverBody>
      ) : (
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <EventDockGuide />
        </div>
      )}
    </DockPanel>
  )
}
