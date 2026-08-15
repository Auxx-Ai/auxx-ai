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
import { CircleCheck, History, TriangleAlert } from 'lucide-react'
import type { RefObject } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useMailSuggestions } from '~/components/mail-suggestions/hooks/use-mail-suggestions'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { useNotificationPanelStore } from '../notification-panel-store'
import { AccessRequestRow } from './items/access-request-row'
import { ConfirmationRow } from './items/confirmation-row'
import { DecidedRow } from './items/decided-row'
import { DuplicateRow } from './items/duplicate-row'
import { MailSuggestionRow } from './items/mail-suggestion-row'
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

/**
 * Cursor-paged like the suggestions section above it, and for a sharper reason:
 * the badge counts EVERY open pair while a fixed-size query renders only the
 * first page, so a plain `useQuery` left the difference counted but unreachable
 * (measured during Phase 5 verification: badge 70, list 25, no way to see the
 * rest).
 */
const DUPLICATE_FILTERS = { limit: 25 } as const

/** How long the flashed ring stays on a highlighted confirmation. */
const HIGHLIGHT_MS = 2000

/**
 * Body of the notification panel's Approvals tab.
 *
 * Splits on the panel's `approvalsView` sub-filter, which renders in the filter
 * strip above the scroller. The two views share nothing but the row chrome: one
 * is a work queue whose rows carry mutations, the other is a read-only record.
 */
export function ApprovalsTab({ viewportRef }: ApprovalsTabProps) {
  const approvalsView = useNotificationPanelStore((state) => state.approvalsView)
  return approvalsView === 'past' ? (
    <PastApprovals viewportRef={viewportRef} />
  ) : (
    <PendingApprovals viewportRef={viewportRef} />
  )
}

/**
 * Everything still waiting on the viewer.
 *
 * Labelled sections rather than one merged stream: the sources paginate
 * differently and carry different urgency — an unanswered workflow confirmation
 * blocks a live run and expires, an unanswered suggestion costs nothing. See
 * plans/today/02-approvals-tab.md §3.
 *
 * `FeatureKey.todayInbox` gates the suggestions section only. Workflow
 * confirmations are not feature-flagged and stay visible without it.
 */
function PendingApprovals({ viewportRef }: ApprovalsTabProps) {
  const { hasAccess } = useFeatureFlags()
  const suggestionsEnabled = hasAccess(FeatureKey.todayInbox)
  const duplicatesEnabled = hasAccess(FeatureKey.duplicateDetection)
  const utils = api.useUtils()
  const highlightApprovalId = useNotificationPanelStore((state) => state.highlightApprovalId)
  const clearHighlight = useNotificationPanelStore((state) => state.clearHighlight)
  const [flashedId, setFlashedId] = useState<string>()

  // Confirmations publish `approval` / `approval:resolved` on the viewer's user
  // room (`useNotificationSubscription`), which invalidates this query. Focus
  // refetch stays as the backstop for a missed frame and for suggestions, which
  // are still refetch-driven pending the `ownerScope` call (plan §6).
  const confirmations = api.approval.list.useQuery(
    { view: 'pending' },
    { refetchOnWindowFocus: true }
  )
  const suggestions = api.approvals.list.useInfiniteQuery(SUGGESTION_FILTERS, {
    enabled: suggestionsEnabled,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
  })
  /**
   * The fourth source (§8.2). **Not gated on `FeatureKey.todayInbox`** — that key
   * gates the AI-suggestions section only, and this is a different feature for a
   * different audience. It is also capped at five cards per inbox by the mining
   * job, so it needs no pagination of its own.
   */
  const mailSuggestions = useMailSuggestions()
  /**
   * The fifth source (plan §3.2). Gated on `FeatureKey.duplicateDetection` and
   * skipped entirely when the org does not have it — the same shape as the
   * suggestions section above, and the reason the router may refuse outright
   * rather than answering with an empty list.
   */
  const duplicates = api.duplicates.list.useInfiniteQuery(DUPLICATE_FILTERS, {
    enabled: duplicatesEnabled,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
  })

  // Deadline order — soonest expiry first, undated last. Correct only because the
  // pending view is fetched as one page (the router asks for 100), so this sorts
  // the whole set rather than a window into it.
  const confirmationItems = useMemo(() => {
    const items = confirmations.data?.items ?? []
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

  const mailSuggestionItems = mailSuggestions.data ?? []
  const duplicateItems = useMemo(
    () => duplicates.data?.pages.flatMap((page) => page?.items ?? []) ?? [],
    [duplicates.data]
  )

  /**
   * The acting client refetches both lists and both badge counts itself rather
   * than waiting for its own `approval:resolved` frame, so the tab badge cannot
   * drift from what the sections show.
   */
  const onResolved = () => {
    // Both views: a decision moves the row from one to the other, so leaving the
    // past list cached would show a stale history the moment the user switches.
    void utils.approval.list.invalidate()
    void utils.approval.getPendingCount.invalidate()
    void utils.approvals.list.invalidate()
    void utils.approvals.count.invalidate()
  }

  /**
   * Mail rows invalidate their own two queries inside
   * `useMailSuggestionActions`; this only keeps the bell badge honest, which
   * reads the count query rather than the list.
   */
  const onMailResolved = () => {
    void utils.mailSuggestions.count.invalidate()
  }

  /**
   * Dismiss, snooze and merge all change what the queue contains, so both the
   * list and the badge term are refetched by the acting client rather than
   * waiting for a frame that this feature deliberately does not publish
   * (realtime is out of v1 — the tab is refetch-driven).
   */
  const onDuplicateResolved = () => {
    void utils.duplicates.list.invalidate()
    void utils.duplicates.count.invalidate()
    void utils.duplicates.forRecord.invalidate()
  }

  const isLoading =
    confirmations.isLoading ||
    (suggestionsEnabled && suggestions.isLoading) ||
    mailSuggestions.isLoading ||
    (duplicatesEnabled && duplicates.isLoading)
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
  const loadError =
    confirmations.error ??
    (suggestionsEnabled ? suggestions.error : null) ??
    mailSuggestions.error ??
    (duplicatesEnabled ? duplicates.error : null)
  if (
    loadError &&
    !confirmationItems.length &&
    !suggestionItems.length &&
    !mailSuggestionItems.length &&
    !duplicateItems.length
  ) {
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
                void mailSuggestions.refetch()
                if (duplicatesEnabled) void duplicates.refetch()
              }}>
              Try again
            </Button>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (
    !confirmationItems.length &&
    !suggestionItems.length &&
    !mailSuggestionItems.length &&
    !duplicateItems.length
  ) {
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

      {/* Last, deliberately (§8.2): sections split by urgency, and this is the
          least urgent source in the panel. An unanswered workflow confirmation
          blocks a live run and expires; an unanswered mail suggestion costs
          nothing. */}
      {mailSuggestionItems.length ? (
        <section>
          <SectionHeader label='Mail suggestions' count={mailSuggestionItems.length} />
          {mailSuggestionItems.map((suggestion) => (
            <MailSuggestionRow
              key={suggestion.id}
              suggestion={suggestion}
              onResolved={onMailResolved}
            />
          ))}
        </section>
      ) : null}

      {/* Last of all, and the order is deliberate (§3.2): the tab is a fixed
          urgency ladder, and data hygiene is the least urgent lane in it. A
          workflow confirmation blocks a live run and expires; a duplicate pair
          will still be a duplicate tomorrow. */}
      {duplicateItems.length ? (
        <section>
          <SectionHeader label='Possible duplicates' count={duplicateItems.length} />
          {duplicateItems.map((pair) => (
            <DuplicateRow key={pair.id} pair={pair} onResolved={onDuplicateResolved} />
          ))}
          <InfiniteScroll
            isLoading={duplicates.isFetchingNextPage}
            hasMore={!!duplicates.hasNextPage}
            next={() => duplicates.fetchNextPage()}
            root={viewportRef.current}
            rootMargin='200px'>
            <div className='h-px' />
          </InfiniteScroll>
          {duplicates.isFetchingNextPage ? <NotificationRowSkeleton /> : null}
        </section>
      ) : null}
    </>
  )
}

/**
 * Approvals the viewer can no longer act on — decided, withdrawn, or lapsed.
 *
 * Scoped to the `ApprovalRequest` lane (workflow confirmations + access requests),
 * NOT the AI suggestion bundles. Those have terminal statuses too and
 * `approvals.list` already accepts them, but `SuggestionRow` reads every non-FRESH
 * status as "out of date — the record changed since this was proposed", so an
 * approved bundle would render with copy that is simply false. Splitting `STALE`
 * from the terminal statuses in that row is the prerequisite, and it is its own
 * change.
 *
 * The audience is wider than the pending view's on purpose: this lists what the
 * viewer was involved in, including requests they filed themselves, which they are
 * never an assignee of. See `listApprovalsForUser`.
 */
function PastApprovals({ viewportRef }: ApprovalsTabProps) {
  const past = api.approval.list.useInfiniteQuery(
    { view: 'past' },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      refetchOnWindowFocus: false,
    }
  )

  const items = useMemo(() => past.data?.pages.flatMap((page) => page.items) ?? [], [past.data])

  if (past.isLoading) {
    return (
      <>
        <NotificationRowSkeleton />
        <NotificationRowSkeleton />
        <NotificationRowSkeleton />
      </>
    )
  }

  // Same rule as the pending view: an empty list and a failed one must not look
  // alike. A history that quietly claims nothing ever happened is worse than one
  // that admits it could not load.
  if (past.error && !items.length) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <Empty className='border-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Couldn't load past approvals</EmptyTitle>
            <EmptyDescription>{past.error.message}</EmptyDescription>
            <Button variant='outline' size='sm' onClick={() => void past.refetch()}>
              Try again
            </Button>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <Empty className='border-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <History />
            </EmptyMedia>
            <EmptyTitle>No past approvals</EmptyTitle>
            <EmptyDescription>
              Requests you decide or file will show up here once they're resolved.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <section>
      {/* No count: this list pages, so any number here would be "loaded so far"
          rather than a total, and would climb as the viewer scrolls. */}
      <SectionHeader label='Decided' />
      {items.map((request) => (
        <DecidedRow key={request.id} request={request} />
      ))}
      <InfiniteScroll
        isLoading={past.isFetchingNextPage}
        hasMore={!!past.hasNextPage}
        next={() => past.fetchNextPage()}
        root={viewportRef.current}
        rootMargin='200px'>
        <div className='h-px' />
      </InfiniteScroll>
      {past.isFetchingNextPage ? <NotificationRowSkeleton /> : null}
    </section>
  )
}

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className='flex items-center gap-1.5 px-3 pt-1 pb-1.5 font-medium text-muted-foreground text-xs'>
      <span className='uppercase tracking-wide'>{label}</span>
      {count === undefined ? null : <span className='font-normal'>({count})</span>}
    </div>
  )
}
