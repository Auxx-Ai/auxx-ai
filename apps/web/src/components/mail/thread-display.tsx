// apps/web/src/components/mail/thread-display.tsx
import ThreadDetails from './thread-details'
import { ThreadProvider } from './thread-provider'
import BulkActionToolbar from './bulk-action-toolbar'
import { useMailFilter } from './mail-filter-context'
import ChatInterface from '../mail-views/chat-interface'
import { EmptyState } from '../global/empty-state'
import { Mail, Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import NewMessageDialog from './email-editor/new-message-dialog'
import { useHasMultipleSelected, useFirstSelectedThreadId } from '~/components/threads/store'
import { useThread } from '~/components/threads/hooks'
import type { IntegrationProvider } from '~/components/threads/store/thread-store'

/** Chat providers that use ChatInterface instead of ThreadDetails */
const CHAT_PROVIDERS: IntegrationProvider[] = ['FACEBOOK', 'INSTAGRAM', 'OPENPHONE']

/** Check if thread should use chat interface based on integration provider */
function isChatThread(provider: IntegrationProvider | null): boolean {
  return provider !== null && CHAT_PROVIDERS.includes(provider)
}

/**
 * ThreadDisplay - displays the selected thread details or bulk action toolbar.
 * Gets thread data from Zustand store.
 */
export function ThreadDisplay() {
  const { viewMode } = useMailFilter()

  // Granular selectors for minimal re-renders
  const hasMultipleSelected = useHasMultipleSelected()
  const threadId = useFirstSelectedThreadId()

  // Get thread from store
  const { thread, isLoading } = useThread({ threadId })

  const showBulkToolbar = hasMultipleSelected || viewMode === 'edit'

  return (
    <div className="flex h-full flex-col flex-1">
      {/* BulkActionToolbar is self-contained - reads selection from store */}
      <BulkActionToolbar />
      {!showBulkToolbar && (
        <>
          {thread ? (
            // Determine thread type from integration provider
            isChatThread(thread.integrationProvider) ? (
              <ChatInterface threadId={thread.id} sessionId={thread.externalId} thread={thread} />
            ) : (
              <ThreadProvider threadId={thread.id}>
                <ThreadDetails />
              </ThreadProvider>
            )
          ) : isLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
            </div>
          ) : (
            <EmptyState
              icon={Mail}
              title="No message selected"
              description="Select a message to view its details."
              button={
                <NewMessageDialog
                  trigger={
                    <Button variant="outline">
                      <Plus size={16} />
                      <span>Compose Message</span>
                    </Button>
                  }
                />
              }
            />
          )}
        </>
      )}
    </div>
  )
}
