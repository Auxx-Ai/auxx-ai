// apps/web/src/components/global/notifications/ui/approvals-tab.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import InfiniteScroll from '@auxx/ui/components/infinite-scroll'
import { CircleCheck, TriangleAlert } from 'lucide-react'
import type { RefObject } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { useNotificationPanelStore } from '../notification-panel-store'
import { AccessRequestRow } from './items/access-request-row'
import { ConfirmationRow } from './items/confirmation-row'
import { SuggestionRow } from './items/suggestion-row'
import { NotificationRowSkeleton } from './notification-row'

interface ApprovalsTabProps {
  /**
   * The panel's `ScrollArea` viewport — the `InfiniteScroll` sentinel needs it as
   * its intersection root, since the scroller is an ancestor and not the window.
   */
  viewportRef: RefObject<HTMLDivElement | null>
}

const SUGGESTION_FILTERS = {
  filters: { ownerScope: 'mine_and_unassigned', status: ['FRESH'] },
  limit: 25,
} as const

/** How long the flashed ring stays on a highlighted confirmation. */
const HIGHLIGHT_MS = 2000

/**
 * Body of the notification panel's Approvals tab.
 *
 * Two labelled sections rather than one merged stream: the sources paginate
 * differently and carry different urgency — an unanswered workflow confirmation
 * blocks a live run and expires, an unanswered suggestion costs nothing. See
 * plans/today/02-approvals-tab.md §3.
 *
 * `FeatureKey.todayInbox` gates the suggestions section only. Workflow
 * confirmations are not feature-flagged and stay visible without it.
 */
export function ApprovalsTab({ viewportRef }: ApprovalsTabProps) {
  const { hasAccess } = useFeatureFlags()
  const suggestionsEnabled = hasAccess(FeatureKey.todayInbox)
  const utils = api.useUtils()
  const highlightApprovalId = useNotificationPanelStore((state) => state.highlightApprovalId)
  const clearHighlight = useNotificationPanelStore((state) => state.clearHighlight)
  const [flashedId, setFlashedId] = useState<string>()

  // Confirmations publish `approval` / `approval:resolved` on the viewer's user
  // room (`useNotificationSubscription`), which invalidates this query. Focus
  // refetch stays as the backstop for a missed frame and for suggestions, which
  // are still refetch-driven pending the `ownerScope` call (plan §6).
  const confirmations = api.approval.getPendingRequests.useQuery(undefined, {
    refetchOnWindowFocus: true,
  })
  const suggestions = api.approvals.list.useInfiniteQuery(SUGGESTION_FILTERS, {
    enabled: suggestionsEnabled,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
  })

  // Deadline order — soonest expiry first, undated last.
  const confirmationItems = useMemo(() => {
    const items = confirmations.data ?? []
    return [...items].sort((a, b) => {
      const left = a.expiresAt ? new Date(a.expiresAt).getTime() : null
      const right = b.expiresAt ? new Date(b.expiresAt).getTime() : null
      if (left === null && right === null) return 0
      if (left === null) return 1
      if (right === null) return -1
      return left - right
    })
  }, [confirmations.data])

  const suggestionItems = useMemo(
    () => suggestions.data?.pages.flatMap((page) => page?.items ?? []) ?? [],
    [suggestions.data]
  )

  /**
   * The acting client refetches both lists and both badge counts itself rather
   * than waiting for its own `approval:resolved` frame, so the tab badge cannot
   * drift from what the sections show.
   */
  const onResolved = () => {
    void utils.approval.getPendingRequests.invalidate()
    void utils.approval.getPendingCount.invalidate()
    void utils.approvals.list.invalidate()
    void utils.approvals.count.invalidate()
  }

  const isLoading = confirmations.isLoading || (suggestionsEnabled && suggestions.isLoading)
  const highlightIsListed = confirmationItems.some((item) => item.id === highlightApprovalId)

  /**
   * A notification row asked for one request by id: scroll it into view and flash a
   * ring, then drop the highlight so re-opening the tab does not replay it. An id
   * that is not in the list (already answered, or the viewer is not an approver) is
   * cleared silently — there is nothing useful to say about it.
   */
  useEffect(() => {
    if (!highlightApprovalId || isLoading) return
    if (!highlightIsListed) {
      clearHighlight()
      return
    }
    const element = document.querySelector(
      `[data-notification-id="${CSS.escape(highlightApprovalId)}"]`
    )
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlashedId(highlightApprovalId)
    const timer = setTimeout(() => {
      setFlashedId(undefined)
      clearHighlight()
    }, HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightApprovalId, highlightIsListed, isLoading, clearHighlight])

  if (isLoading) {
    return (
      <>
        <NotificationRowSkeleton />
        <NotificationRowSkeleton />
        <NotificationRowSkeleton />
      </>
    )
  }

  // A failed query must not read as "no work to do". Both sources returning
  // nothing looks identical to both sources erroring, and an approval inbox that
  // quietly claims to be empty is worse than one that admits it is broken.
  const loadError = confirmations.error ?? (suggestionsEnabled ? suggestions.error : null)
  if (loadError && !confirmationItems.length && !suggestionItems.length) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <Empty className='border-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Couldn't load approvals</EmptyTitle>
            <EmptyDescription>{loadError.message}</EmptyDescription>
            <Button
              variant='outline'
              size='sm'
              onClick={() => {
                void confirmations.refetch()
                if (suggestionsEnabled) void suggestions.refetch()
              }}>
              Try again
            </Button>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (!confirmationItems.length && !suggestionItems.length) {
    return (
      // flex-1 against the ScrollArea content wrapper's `min-h-full flex
      // flex-col`, so the empty state centres in the whole panel.
      <div className='flex flex-1 items-center justify-center'>
        <Empty className='border-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <CircleCheck />
            </EmptyMedia>
            <EmptyTitle>Nothing needs your approval</EmptyTitle>
            <EmptyDescription>You're all caught up.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <>
      {confirmationItems.length ? (
        <section>
          <SectionHeader label='Needs a decision' count={confirmationItems.length} />
          {/* Both kinds live in one section, ordered by deadline together (plan 28
              H1 is what makes access rows appear here at all). They get different
              rows because the payload and the cost of Deny are different — see
              `AccessRequestRow`. No wrapper element: the flash ring and the scroll
              anchor both belong on the card `NotificationRow` draws, which is inset
              from the section by its own margins. */}
          {confirmationItems.map((request) =>
            request.kind === 'access' ? (
              <AccessRequestRow
                key={request.id}
                request={request}
                onResolved={onResolved}
                highlighted={flashedId === request.id}
              />
            ) : (
              <ConfirmationRow
                key={request.id}
                request={request}
                onResolved={onResolved}
                highlighted={flashedId === request.id}
              />
            )
          )}
        </section>
      ) : null}

      {suggestionItems.length ? (
        <section>
          <SectionHeader label='Suggestions' count={suggestionItems.length} />
          {suggestionItems.map((bundle) => (
            <SuggestionRow key={bundle.id} bundle={bundle} onResolved={onResolved} />
          ))}
          <InfiniteScroll
            isLoading={suggestions.isFetchingNextPage}
            hasMore={!!suggestions.hasNextPage}
            next={() => suggestions.fetchNextPage()}
            root={viewportRef.current}
            rootMargin='200px'>
            <div className='h-px' />
          </InfiniteScroll>
          {suggestions.isFetchingNextPage ? <NotificationRowSkeleton /> : null}
        </section>
      ) : null}
    </>
  )
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className='flex items-center gap-1.5 px-3 pt-1 pb-1.5 font-medium text-muted-foreground text-xs'>
      <span className='uppercase tracking-wide'>{label}</span>
      <span className='font-normal'>({count})</span>
    </div>
  )
}
