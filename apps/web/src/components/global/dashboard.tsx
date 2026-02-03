// File: src/app/(protected)/app/mail/_components/dashboard.tsx
'use client'
import React, { useCallback, useState } from 'react'
import AppSidebar from '~/components/global/sidebar'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  pointerWithin,
  type Active,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { createPortal } from 'react-dom'
import { toastSuccess } from '@auxx/ui/components/toast'
import MailThreadItemDragOverlay from '~/components/mail/mail-thread-item-drag-overlay'
import { DndStateProvider } from '~/app/context/dnd-state-context'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import { useThreadMutation } from '~/components/threads/hooks'
import { SidebarInset, SidebarProvider } from '@auxx/ui/components/sidebar'
import {
  useDehydratedOrganization,
  useDehydratedOrganizationId,
} from '~/providers/dehydrated-state-provider'
import { toRecordId } from '@auxx/types/resource'

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

  // Redirect to onboarding if org hasn't completed it (client-side only)
  React.useEffect(() => {
    if (!orgCompletedOnboarding && !pathname.includes('/app/onboarding')) {
      router.push('/app/onboarding')
    }
  }, [orgCompletedOnboarding, pathname, router])

  // Check organization's onboarding status (not user's)
  if (!orgCompletedOnboarding) {
    if (!pathname.includes('/app/onboarding')) {
      // Show nothing while redirecting
      return null
    } else {
      return <div className="onboarding">{children}</div>
    }
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
          <div className="flex h-screen overflow-hidden w-full">
            <AppSidebar className="min-w-0" user={user} />
            <SidebarInset>{children}</SidebarInset>
          </div>
        </DndStateProvider>
        {portalContainer &&
          createPortal(
            <DragOverlay
              dropAnimation={null}
              adjustScale={false}
              modifiers={[snapCenterToCursor]}
              style={{ width: 'auto' }}
              className="w-auto">
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
