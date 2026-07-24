// File: src/app/(protected)/app/mail/_components/dashboard.tsx
'use client'
import { toRecordId } from '@auxx/types/resource'
import { SidebarInset, SidebarProvider } from '@auxx/ui/components/sidebar'
import { toastSuccess } from '@auxx/ui/components/toast'
import {
  type Active,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { usePathname, useRouter } from 'next/navigation'
import React, { useCallback, useState } from 'react'
import { DndStateProvider } from '~/app/context/dnd-state-context'
import { OverageBanner } from '~/components/banner/overage-banner'
import { DemoBanner } from '~/components/demo/demo-banner'
import { isSidebarFavoriteDrag } from '~/components/favorites/drag-eligibility'
import { useFavoriteDragEnd } from '~/components/favorites/hooks/use-favorite-drag-end'
import { AppDragOverlay } from '~/components/global/app-drag-overlay'
import { NotificationPanelRoot } from '~/components/global/notifications/notification-panel-root'
import AppSidebar from '~/components/global/sidebar'
import { SidebarDragPeek } from '~/components/global/sidebar/sidebar-drag-peek'
import { KopilotDock } from '~/components/kopilot/ui/kopilot-dock'
import { KopilotRuntime } from '~/components/kopilot/ui/kopilot-runtime'
import { useThreadMutation } from '~/components/threads/hooks'
import { useOverages } from '~/hooks/use-overages'
import {
  useDehydratedOrganization,
  useDehydratedOrganizationId,
} from '~/providers/dehydrated-state-provider'

type Props = {
  user?: any
  children: React.ReactNode
  /** SSR-provided from the `sidebar_state` cookie so the sidebar doesn't flash open on load. */
  defaultSidebarOpen?: boolean
  /** SSR-provided from the `sidebar_state_width` cookie so the width doesn't flash on load. */
  defaultSidebarWidth?: number
}

export const Dashboard = ({
  // slug,
  user,
  children,
  defaultSidebarOpen,
  defaultSidebarWidth,
}: Props) => {
  const pathname = usePathname()
  const router = useRouter()

  // Get organization's onboarding status from dehydrated state
  const organizationId = useDehydratedOrganizationId()
  const currentOrg = useDehydratedOrganization(organizationId)
  const orgCompletedOnboarding = currentOrg?.completedOnboarding ?? false
  const overages = useOverages(organizationId)

  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [activeDndItem, setActiveDndItem] = useState<Active | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string)
    setActiveDndItem(event.active)
  }, [])

  // Redirect to onboarding if org hasn't completed it.
  // Uses full navigation since onboarding is in a separate route group.
  React.useEffect(() => {
    if (!orgCompletedOnboarding) {
      window.location.href = '/onboarding'
    }
  }, [orgCompletedOnboarding])

  // Show nothing while redirecting to onboarding
  if (!orgCompletedOnboarding) {
    return null
  }

  // Use unified mutation hook for optimistic updates
  const { updateBulk } = useThreadMutation()
  const handleFavoriteDragEnd = useFavoriteDragEnd()

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveDragId(null)
      setActiveDndItem(null)

      if (!over || active.id === over.id) return

      const activeData = active.data.current ?? {}
      const overData = over.data.current ?? {}

      if (activeData.type === 'thread' && overData.type === 'shared-inbox-target') {
        const droppedThreadIds: string[] = activeData.draggedThreadIds ?? []
        const targetInboxId: string = overData.inboxId
        if (droppedThreadIds.length > 0 && targetInboxId) {
          // Convert raw inbox ID to RecordId format for tRPC schema validation
          const inboxRecordId = toRecordId('inbox', targetInboxId)
          // Use optimistic update - store updates immediately
          updateBulk(droppedThreadIds, { inboxId: inboxRecordId })
          toastSuccess({ title: `${droppedThreadIds.length} thread(s) moved` })
        }
        return
      }

      if (isSidebarFavoriteDrag(active)) {
        handleFavoriteDragEnd(activeData as Parameters<typeof handleFavoriteDragEnd>[0], overData)
      }
    },
    [updateBulk, handleFavoriteDragEnd]
  )

  return (
    <SidebarProvider resizable defaultOpen={defaultSidebarOpen} defaultWidth={defaultSidebarWidth}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}>
        <SidebarDragPeek />
        <DndStateProvider activeDndItem={activeDndItem}>
          <div className='flex h-screen overflow-hidden w-full'>
            <AppSidebar className='min-w-0' user={user} />
            {/* Safe-area insets live on the content surface (not the bare
                shell) so its bg paints full-bleed to the screen edges while
                content stays clear of the notch / home indicator. */}
            <SidebarInset className='min-h-0 pt-safe pb-safe pl-safe pr-safe'>
              <DemoBanner />
              <OverageBanner overages={overages} />
              {children}
            </SidebarInset>
            <KopilotDock />
            {/* Headless turn runner + task-notification watches. Sibling of the
                dock — it must stay alive when the dock renders null (kopilot
                page, panel closed). */}
            <KopilotRuntime />
          </div>
        </DndStateProvider>
        <AppDragOverlay />
      </DndContext>
      <NotificationPanelRoot />
    </SidebarProvider>
  )
}
