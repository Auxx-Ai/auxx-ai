// File: src/app/(protected)/app/mail/_components/dashboard.tsx
'use client'
import { toRecordId } from '@auxx/types/resource'
import { SidebarInset, SidebarProvider } from '@auxx/ui/components/sidebar'
import { toastSuccess } from '@auxx/ui/components/toast'
import {
  type Active,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { usePathname, useRouter } from 'next/navigation'
import React, { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { DndStateProvider } from '~/app/context/dnd-state-context'
import { OverageBanner } from '~/components/banner/overage-banner'
import { DemoBanner } from '~/components/demo/demo-banner'
import AppSidebar from '~/components/global/sidebar'
import MailThreadItemDragOverlay from '~/components/mail/mail-thread-item-drag-overlay'
import { useThreadMutation } from '~/components/threads/hooks'
import { useOverages } from '~/hooks/use-overages'
import {
  useDehydratedOrganization,
  useDehydratedOrganizationId,
} from '~/providers/dehydrated-state-provider'

type Props = { user?: any; children: React.ReactNode }

export const Dashboard = ({
  // slug,
  user,
  children,
}: Props) => {
  const pathname = usePathname()
  const router = useRouter()

  // Get organization's onboarding status from dehydrated state
  const organizationId = useDehydratedOrganizationId()
  const currentOrg = useDehydratedOrganization(organizationId)
  const orgCompletedOnboarding = currentOrg?.completedOnboarding ?? false
  const overages = useOverages(organizationId)

  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [activeDragData, setActiveDragData] = useState<Record<string, any> | null>(null)
  const [activeDndItem, setActiveDndItem] = useState<Active | null>(null)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)

  React.useEffect(() => {
    setPortalContainer(document.body)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string)
    setActiveDragData(event.active.data.current ?? {})
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

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveDragId(null)
      setActiveDragData(null)
      setActiveDndItem(null)

      if (over && active.id !== over.id) {
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
        }
      }
    },
    [updateBulk]
  )

  return (
    <SidebarProvider>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}>
        <DndStateProvider activeDndItem={activeDndItem}>
          <div className='flex h-screen overflow-hidden w-full'>
            <AppSidebar className='min-w-0' user={user} />
            <SidebarInset className='min-h-0'>
              <DemoBanner />
              <OverageBanner overages={overages} />
              {children}
            </SidebarInset>
          </div>
        </DndStateProvider>
        {portalContainer &&
          createPortal(
            <DragOverlay
              dropAnimation={null}
              adjustScale={false}
              modifiers={[snapCenterToCursor]}
              style={{ width: 'auto' }}
              className='w-auto'>
              {activeDndItem?.data.current?.type === 'thread' ? (
                <MailThreadItemDragOverlay
                  items={activeDragData?.draggedThreadIds ?? []}
                  isDragging
                />
              ) : null}
            </DragOverlay>,
            portalContainer
          )}
      </DndContext>
    </SidebarProvider>
  )
}
