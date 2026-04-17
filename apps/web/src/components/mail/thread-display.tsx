// apps/web/src/components/mail/thread-display.tsx

import { Button } from '@auxx/ui/components/button'
import { AtSignIcon } from '@auxx/ui/components/icons/at-sign-icon'
import { cn } from '@auxx/ui/lib/utils'
import { Mail, Plus, Waypoints } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'
import { useThread, useThreadReadStatus } from '~/components/threads/hooks'
import { useActiveThreadId, useHasMultipleSelected } from '~/components/threads/store'
import type { ChannelProvider } from '~/components/threads/store/thread-store'
import { useCompose } from '~/hooks/use-compose'
import { useUser } from '~/hooks/use-user'
import { EmptyState } from '../global/empty-state'
import ChatInterface from '../mail-views/chat-interface'
import BulkActionToolbar from './bulk-action-toolbar'
import { useMailFilter } from './mail-filter-context'
import ThreadDetails from './thread-details'
import { ThreadProvider } from './thread-provider'

/** Chat providers that use ChatInterface instead of ThreadDetails */
const CHAT_PROVIDERS: ChannelProvider[] = ['FACEBOOK', 'INSTAGRAM', 'OPENPHONE']

/** Check if thread should use chat interface based on integration provider */
function isChatThread(provider: ChannelProvider | null): boolean {
  return provider !== null && CHAT_PROVIDERS.includes(provider)
}

interface ThreadDisplayProps {
  /** When true, centers the content with a max-width for full-page list view */
  centered?: boolean
}

/**
 * ThreadDisplay - displays the selected thread details or bulk action toolbar.
 * Gets thread data from Zustand store.
 */
export function ThreadDisplay({ centered }: ThreadDisplayProps = {}) {
  const { openCompose } = useCompose()
  const { hasOnlyForwardingChannel } = useUser()
  const { viewMode } = useMailFilter()

  // Granular selectors for minimal re-renders.
  // The detail pane follows the *active* thread (the one the user opened),
  // which is independent from the checkbox-driven selectedThreadIds.
  const hasMultipleSelected = useHasMultipleSelected()
  const threadId = useActiveThreadId()

  // Get thread from store
  const { thread, isLoading } = useThread({ threadId })
  const { isUnread, markAsRead } = useThreadReadStatus(threadId)

  // Mark thread as read when displayed
  useEffect(() => {
    if (threadId && isUnread) {
      markAsRead()
    }
  }, [threadId, isUnread, markAsRead])

  // BulkActionToolbar is self-managing (renders only when it has selection / edit mode).
  // The detail pane follows the *active* thread: whenever the user has opened one,
  // show it even if checkbox-multi-select is active or we're in edit mode.
  const bulkToolbarActive = hasMultipleSelected || viewMode === 'edit'

  return (
    <div className='flex h-full flex-col flex-1'>
      <BulkActionToolbar />
      {thread ? (
        isChatThread(thread.integrationProvider) ? (
          <ChatInterface
            threadId={thread.id}
            sessionId={thread.externalId}
            thread={thread}
            centered={centered}
          />
        ) : (
          <ThreadProvider threadId={thread.id}>
            <ThreadDetails centered={centered} />
          </ThreadProvider>
        )
      ) : isLoading ? (
        <div className='flex h-full items-center justify-center'>
          <div className='h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent'></div>
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
              <Link href='/app/settings/channels/new'>
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
