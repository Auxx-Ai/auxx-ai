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
  useDehydratedUser,
} from '~/providers/dehydrated-state-provider'

/**
 * Per-tab timestamp of the last bounce this gate made to `/onboarding`.
 * `sessionStorage`, not state: the redirect is a full page load, so nothing in
 * React survives it.
 */
const ONBOARDING_BOUNCE_KEY = 'auxx:onboarding-bounce-at'

/**
 * A return inside this window means `/onboarding` sent the user straight back —
 * i.e. the two pages disagree and this is a loop, not a normal visit. A loop
 * turns the round trip around in about a second; someone who abandons onboarding
 * and later navigates to `/app` by hand is far outside it and still gets gated.
 */
const ONBOARDING_BOUNCE_WINDOW_MS = 15_000

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

  // Get onboarding status from dehydrated state. Two INDEPENDENT gates: the org
  // gate covers workspace setup, the user gate covers the personal step (name +
  // avatar). An invited member joins an already-onboarded org, so only the user
  // gate ever catches them — without it they land in the app with no name.
  const organizationId = useDehydratedOrganizationId()
  const currentOrg = useDehydratedOrganization(organizationId)
  const dehydratedUser = useDehydratedUser()
  const orgCompletedOnboarding = currentOrg?.completedOnboarding ?? false
  const userCompletedOnboarding = dehydratedUser?.completedOnboarding ?? false
  const needsOnboarding = !orgCompletedOnboarding || !userCompletedOnboarding
  const overages = useOverages(organizationId ?? undefined)

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

  // Redirect to onboarding if either gate is open. `/onboarding` is the single
  // place that decides WHICH step is missing.
  // Uses full navigation since onboarding is in a separate route group.
  //
  // AT MOST ONCE per tab, and that bound is the point. This gate reads the CACHED
  // dehydrated state; `/onboarding` reads the row. Whenever those two disagree
  // they redirect at each other forever, and neither one ever consults the
  // other's source, so nothing in the cycle can break it. It has happened with a
  // different stale writer each time (#317 session cookie cache, the demo route's
  // direct Drizzle writes, #1381 `userProfile`, and a lost invalidation race in
  // the org cache) — so the bounce is bounded here rather than waiting to fix the
  // next writer. Coming back still needing onboarding means the cache is lying;
  // `/onboarding` only sends anyone here when the row says they are done, so
  // rendering the app is the correct read. Onboarding is a UX gate, never an
  // authorization one — `(protected)/layout.tsx` is what enforces access.
  const [onboardingBounceSpent, setOnboardingBounceSpent] = useState(false)

  React.useEffect(() => {
    if (!needsOnboarding) {
      try {
        sessionStorage.removeItem(ONBOARDING_BOUNCE_KEY)
      } catch {
        // Private mode / storage disabled — the in-memory guard still holds.
      }
      return
    }

    let bouncedAt = 0
    try {
      bouncedAt = Number(sessionStorage.getItem(ONBOARDING_BOUNCE_KEY) ?? 0)
    } catch {
      // Unreadable storage — fall through and bounce.
    }

    if (bouncedAt && Date.now() - bouncedAt < ONBOARDING_BOUNCE_WINDOW_MS) {
      console.warn(
        '[Onboarding] Bounced straight back from /onboarding still needing onboarding — ' +
          'the cached state disagrees with the database. Rendering the app instead of ' +
          'redirecting again.'
      )
      setOnboardingBounceSpent(true)
      return
    }

    try {
      sessionStorage.setItem(ONBOARDING_BOUNCE_KEY, String(Date.now()))
    } catch {
      // Ignore — worst case we bounce once more on the next hard load.
    }
    window.location.href = '/onboarding'
  }, [needsOnboarding])

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
          // Convert raw inbox ID to RecordId format for tRPC schema validation.
          //
          // `'inbox'` is correct and verified (plan 40a §5.1): the only
          // `shared-inbox-target` droppable is `SharedInboxesSection`
          // (`sidebar/shared-inbox-group.tsx`), which is fed exclusively by
          // `use-mail-sidebar`'s `processedInboxes` — filtered on `!isPersonal`.
          // The personal group (`sidebar/personal-mail-group.tsx`) registers no
          // droppable at all, so a personal mailbox can never be the target and
          // shared mailboxes always live on the `inbox` definition. If a
          // personal drop target is ever added, this must resolve the def.
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

  // Render nothing while the redirect above is in flight. This sits BELOW every
  // hook on purpose: it used to short-circuit before `useThreadMutation`,
  // `useFavoriteDragEnd` and `handleDragEnd`, so the hook count changed the
  // moment the gate flipped and React threw "rendered fewer hooks than expected".
  if (needsOnboarding && !onboardingBounceSpent) {
    return null
  }

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
