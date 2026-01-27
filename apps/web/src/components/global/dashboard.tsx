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
import { api } from '~/trpc/react'
import { toast } from 'sonner'
import MailThreadItemDragOverlay from '~/components/mail/mail-thread-item-drag-overlay'
import { DndStateProvider } from '~/app/context/dnd-state-context'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import { PusherProvider } from '~/providers/pusher-provider'
import { ThreadDataProvider } from '~/components/threads'
import { useQueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { SidebarInset, SidebarProvider } from '@auxx/ui/components/sidebar'
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

  const utils = api.useUtils()
  const queryClient = useQueryClient()

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

  const moveBulkToInbox = api.thread.moveBulkToInbox.useMutation({
    // onSuccess is async to allow awaiting refetchQueries
    onSuccess: async (data, variables) => {
      toast.success(`${variables.threadIds.length} thread(s) moved.`)
      console.log('[Move Success] Mutation successful. Variables:', variables)

      const threadListQueryKey = getQueryKey(api.thread.list)

      // --- SOLUTION ---
      // Invalidate ALL matching queries, not just active ones.
      queryClient.invalidateQueries({
        queryKey: threadListQueryKey,
        exact: false,
        // REMOVE type: 'active'
      })
      // --- END SOLUTION ---
      const targetInboxId = variables.targetInboxId
      const potentialTargetQuery = queryClient
        .getQueryCache()
        .getAll()
        .find((query) => {
          const queryKey = query.queryKey
          // Check if it's an infinite thread list query
          if (
            Array.isArray(queryKey) &&
            queryKey[0]?.[0] === 'thread' &&
            queryKey[0]?.[1] === 'list' &&
            queryKey[1]?.type === 'infinite'
          ) {
            const input = queryKey[1]?.input as any
            // Check if it's for the target specific inbox
            return input?.contextType === 'specific_inbox' && input?.contextId === targetInboxId
            // PROBLEM: We don't know the statusSlug ('unassigned', 'assigned' etc.) the user WILL see
            // Let's assume 'unassigned' is the most likely state after a move
            // return input?.contextType === 'specific_inbox' && input?.contextId === targetInboxId && input?.statusSlug === 'unassigned';
          }
          return false
        })

      if (potentialTargetQuery) {
        console.log(
          `[Move Success] Found potential target query in cache (Key: ${JSON.stringify(potentialTargetQuery.queryKey)}). Triggering manual refetch...`
        )
        try {
          // Refetch this specific query instance
          await queryClient.refetchQueries({ queryKey: potentialTargetQuery.queryKey, exact: true })
          console.log('[Move Success] Manual refetch of target query completed.')
        } catch (error) {
          console.error('[Move Success] Error manually refetching target query:', error)
        }
      } else {
        console.log(
          '[Move Success] Did not find an existing query for the target inbox in the cache to manually refetch.'
        )
        // If not found, we rely SOLELY on the broad invalidation + refetchOnMount when user navigates.
        // Since that isn't working, this manual trigger won't help here.
      }

      console.log('[Move Success] invalidateQueries call completed.')
    },
    onError: (error) => {
      // This part seems less relevant now if onSuccess is called, but keep for completeness
      toast.error(`Failed to move threads: ${error.message}`)
      console.error('Move Error:', error)
    },
  })

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
            moveBulkToInbox.mutate({ threadIds: droppedThreadIds, targetInboxId })
          }
        }
      }
    },
    [moveBulkToInbox, utils]
  )

  return (
    <SidebarProvider>
      <PusherProvider>
        <ThreadDataProvider>
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
        </ThreadDataProvider>
      </PusherProvider>
    </SidebarProvider>
  )
}
