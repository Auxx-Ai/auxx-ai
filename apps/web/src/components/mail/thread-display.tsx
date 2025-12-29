import { api } from '~/trpc/react'
import ThreadDetails from './thread-details'
import { ThreadProvider } from './thread-provider'
import { type RouterOutputs } from '~/server/api/root'
import useThreadSelection from '../kbar/use-thread-selection'
import BulkActionToolbar from './bulk-action-toolbar'
import { useMailFilter } from './mail-filter-context'
import useThreads from '~/hooks/use-threads-filter'
import ChatInterface from '../mail-views/chat-interface'
import { EmptyState } from '../global/empty-state'
import { Mail, Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import NewMessageDialog from './email-editor/new-message-dialog'
import { MessageType } from '@auxx/database/enums'

export function ThreadDisplay() {
  const { viewMode, selectedThreadIds, contextType, contextId, statusSlug, searchQuery } =
    useMailFilter() // Get multi-selection state from context
  const threadId =
    selectedThreadIds && selectedThreadIds.length > 0 ? selectedThreadIds[0] : undefined
  const { threads } = useThreads({ contextType, contextId, statusSlug, searchQuery })
  const _thread = undefined //threads?.find((t) => t.id === threadId) // may need to change this to make it undefined and just fetch the detailed version.

  const {
    data: foundThread,
    isLoading,
    refetch,
  } = api.thread.getById.useQuery(
    { threadId: threadId ?? '' },
    // { enabled: !!!_thread && !!threadId }
    { enabled: !!threadId }
  )
  const thread = foundThread
  const { selectedThreads, clearSelection, selectAll } = useThreadSelection({
    contextType,
    contextId,
    statusSlug,
    searchQuery,
  })
  function handleEmailSent() {
    // Refetch the thread data after sending an email
    // refetch()
  }

  return (
    <div className="flex h-full flex-col flex-1">
      {selectedThreads.length > 1 || viewMode === 'edit' ? (
        <BulkActionToolbar
          selectedThreadIds={selectedThreads}
          onClearSelection={clearSelection}
          refreshData={refetch}
          contextType={contextType}
          contextId={contextId}
          statusSlug={statusSlug}
        />
      ) : (
        <>
          {thread ? (
            // Note: messageType is computed at API boundary from integration.provider
            thread.messageType === MessageType.CHAT ? (
              <ChatInterface
                key={thread.id}
                threadId={thread.id}
                sessionId={thread.externalId}
                thread={thread}
              />
            ) : (
              <ThreadProvider threadId={thread.id} key={thread.id}>
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
                    <Button className="" variant="outline">
                      <Plus size={16} />
                      <span>Compose Message</span>
                    </Button>
                  }
                  onSendSuccess={handleEmailSent}
                />
              }
            />
          )}
        </>
      )}
    </div>
  )
}
