// apps/web/src/app/(protected)/app/tickets/page.tsx

'use client'

import { useState, useCallback } from 'react'
import { MainPageContent } from '@auxx/ui/components/main-page'
import { TicketManagement } from './_components/ticket-management'
import { TicketDetailDrawer } from './_components/ticket-detail-drawer'
import type { Ticket } from './_components/ticket-provider'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'

/**
 * Tickets list page - displays ticket management table with drawer support
 */
export default function TicketsListPage() {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // Drawer state managed at page level for docking support
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  /** Handle ticket selection from TicketManagement */
  const handleTicketSelect = useCallback((ticket: Ticket) => {
    setSelectedTicket(ticket)
    setIsDrawerOpen(true)
  }, [])

  /** Handle drawer open state change */
  const handleDrawerOpenChange = useCallback((open: boolean) => {
    setIsDrawerOpen(open)
    if (!open) setSelectedTicket(null)
  }, [])

  // Build docked panel content (only when docked mode is active)
  const dockedPanel =
    isDocked && isDrawerOpen && selectedTicket ? (
      <TicketDetailDrawer
        ticket={selectedTicket}
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
      {!isDocked && selectedTicket && (
        <TicketDetailDrawer
          ticket={selectedTicket}
          open={isDrawerOpen}
          onOpenChange={handleDrawerOpenChange}
        />
      )}
    </>
  )
}
