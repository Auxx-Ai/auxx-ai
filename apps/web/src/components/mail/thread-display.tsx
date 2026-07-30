// apps/web/src/components/mail/thread-display.tsx

import { Button } from '@auxx/ui/components/button'
import { AtSignIcon } from '@auxx/ui/components/icons/at-sign-icon'
import Loader from '@auxx/ui/components/loader'
import { Plus, Waypoints } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'
import { KopilotContext } from '~/components/kopilot/context'
import { KopilotSuggestion } from '~/components/kopilot/suggestions'
import { useThread, useThreadReadStatus } from '~/components/threads/hooks'
import { useActiveThreadId, useHasMultipleSelected } from '~/components/threads/store'
import { useCompose } from '~/hooks/use-compose'
import { useUser } from '~/hooks/use-user'
import { EmptyState } from '../global/empty-state'
import { useMailFilter } from './mail-filter-context'
import ThreadDetails from './thread-details'
import { ThreadProvider } from './thread-provider'

interface ThreadDisplayProps {
  /** When true, centers the content with a max-width for full-page list view */
  centered?: boolean
  /**
   * URL-derived thread ID. Used as a fallback on the first render before the
   * Zustand store has been hydrated from the URL, so a deep-link refresh shows
   * the spinner immediately instead of flashing "No message selected".
   */
  expectedThreadId?: string | null
}

/**
 * ThreadDisplay - displays the selected thread details or bulk action toolbar.
 * Gets thread data from Zustand store.
 */
export function ThreadDisplay({ centered, expectedThreadId }: ThreadDisplayProps = {}) {
  const { openCompose } = useCompose()
  const { hasOnlyForwardingChannel } = useUser()
  const { viewMode } = useMailFilter()

  // Granular selectors for minimal re-renders.
  // The detail pane follows the *active* thread (the one the user opened),
  // which is independent from the checkbox-driven selectedThreadIds.
  const hasMultipleSelected = useHasMultipleSelected()
  const storeThreadId = useActiveThreadId()
  // Prefer the store (authoritative once hydrated); fall back to the URL hint
  // so the very first render has something to show before store-sync completes.
  const threadId = storeThreadId ?? expectedThreadId ?? null

  // Get thread from store
  const { thread, isLoading, isNotFound, isDeleted } = useThread({ threadId })
  const { isUnread, markAsRead } = useThreadReadStatus(threadId)

  // Read-state is `full`-tier (`UnreadService.setReadStatus` refuses anything
  // below it), so the auto-mark must know the lens before it writes. Both
  // halves matter: `!thread` is the reported path — a share recipient follows
  // the MESSAGE_SHARED deep link, the pane renders from the URL id before the
  // batched meta fetch returns, and firing here earns a rejection toast on
  // open (plan 44 §1.2). This is UX; the server check stays authoritative.
  const canMarkRead = !!thread && (thread.myLens ?? 'read') === 'read'

  // Mark thread as read when displayed. Skip in edit mode — the thread isn't
  // rendered, the user is just multi-selecting.
  useEffect(() => {
    if (threadId && isUnread && canMarkRead && viewMode !== 'edit') {
      markAsRead()
    }
  }, [threadId, isUnread, canMarkRead, markAsRead, viewMode])

  // BulkActionToolbar is self-managing (renders only when it has selection / edit mode).
  // The detail pane follows the *active* thread: whenever the user has opened one,
  // show it even if checkbox-multi-select is active or we're in edit mode.
  const bulkToolbarActive = hasMultipleSelected || viewMode === 'edit'

  // We have a selected thread but haven't received its data yet — show the
  // spinner instead of "No message selected" (covers the frames between
  // URL/store sync and the batched fetch completing). Tombstoned threads
  // (merge source, permanently deleted) are excluded so we don't loop forever
  // waiting on a thread that will never come back.
  const isResolvingThread = !!threadId && !thread && !isNotFound && !isDeleted

  return (
    <div className='flex h-full flex-col flex-1'>
      {thread && <KopilotContext activeThreadId={thread.id} activeThreadLabel={thread.subject} />}
      {thread && (
        <>
          <KopilotSuggestion text='Summarize this thread' icon='sparkle' priority={10} autoSubmit />
          <KopilotSuggestion text='Draft a reply' icon='reply' priority={5} />
          <KopilotSuggestion text='Find similar tickets' icon='search' autoSubmit />
          {thread.ticketId && (
            <KopilotSuggestion text='Show ticket history' icon='history' autoSubmit />
          )}
        </>
      )}
      {thread && viewMode !== 'edit' ? (
        <ThreadProvider threadId={thread.id}>
          <ThreadDetails centered={centered} />
        </ThreadProvider>
      ) : isLoading || isResolvingThread ? (
        <div className='flex h-full items-center justify-center'>
          <Loader size='sm' title='Loading messages...' subtitle='Please wait' />
        </div>
      ) : bulkToolbarActive ? null : (
        <EmptyState
          icon={hasOnlyForwardingChannel ? Waypoints : AtSignIcon}
          title='No message selected'
          description={
            hasOnlyForwardingChannel
              ? 'Connect a channel like Gmail or Outlook to start receiving messages.'
              : 'Select a message to view its details.'
          }
          button={
            hasOnlyForwardingChannel ? (
              <Link href='/app/settings/inbox?connect=personal'>
                <Button variant='outline'>
                  <Plus size={16} />
                  <span>Setup Channel</span>
                </Button>
              </Link>
            ) : (
              <Button variant='outline' onClick={() => openCompose()}>
                <Plus size={16} />
                <span>Compose Message</span>
              </Button>
            )
          }
        />
      )}
    </div>
  )
}
