// apps/web/src/app/(protected)/app/tickets/page.tsx

'use client'

import { MainPageContent } from '@auxx/ui/components/main-page'
import { parseAsString, useQueryState } from 'nuqs'
import { useCallback } from 'react'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { TicketDetailDrawer } from './_components/ticket-detail-drawer'
import { TicketManagement } from './_components/ticket-management'

/**
 * Tickets list page
 * Uses URL state for drawer (e.g., /app/tickets?t=ticketId)
 */
export default function TicketsListPage() {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // Ticket drawer state - synced with URL for deep linking
  const [selectedTicketId, setSelectedTicketId] = useQueryState('t', parseAsString.withDefault(''))

  // Derive drawer open state from whether a ticket is selected
  const isDrawerOpen = !!selectedTicketId
  const handleDrawerOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setSelectedTicketId(null)
    },
    [setSelectedTicketId]
  )

  // Handle ticket selection - updates URL
  const handleTicketSelect = useCallback(
    (ticketId: string) => {
      setSelectedTicketId(ticketId)
    },
    [setSelectedTicketId]
  )

  // Build docked panel content (only when docked mode is active)
  const dockedPanel =
    isDocked && isDrawerOpen && selectedTicketId ? (
      <TicketDetailDrawer
        ticketId={selectedTicketId}
        open={isDrawerOpen}
        onOpenChange={handleDrawerOpenChange}
      />
    ) : undefined

  return (
    <>
      <MainPageContent
        dockedPanel={dockedPanel}
        dockedPanelWidth={dockedWidth}
        onDockedPanelWidthChange={setDockedWidth}
        dockedPanelMinWidth={minWidth}
        dockedPanelMaxWidth={maxWidth}>
        <TicketManagement onTicketSelect={handleTicketSelect} />
      </MainPageContent>

      {/* Overlay drawer - only when NOT docked */}
      {!isDocked && selectedTicketId && (
        <TicketDetailDrawer
          ticketId={selectedTicketId}
          open={isDrawerOpen}
          onOpenChange={handleDrawerOpenChange}
        />
      )}
    </>
  )
}
