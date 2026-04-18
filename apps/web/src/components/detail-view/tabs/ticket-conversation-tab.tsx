// apps/web/src/components/detail-view/tabs/ticket-conversation-tab.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { Link2, Mail, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { MailFilterProvider } from '~/components/mail/mail-filter-context'
import { MailThreadItem } from '~/components/mail/mail-thread-item'
import ThreadDetails from '~/components/mail/thread-details'
import { ThreadProvider } from '~/components/mail/thread-provider'
import { useThreadMutation, useTicketThreads } from '~/components/threads/hooks'
import type { ThreadMeta } from '~/components/threads/store'
import type { DetailViewTabProps } from '../types'
import { LinkThreadDialog } from './ticket-link-thread-dialog'
import { NewThreadForTicketButton } from './ticket-new-thread-button'

/**
 * Conversation tab for ticket detail view.
 * Shows linked threads with a horizontal card scroller and full ThreadDetails below.
 */
export function TicketConversationTab({ entityInstanceId, recordId, record }: DetailViewTabProps) {
  const { threads, isLoading, refresh } = useTicketThreads(entityInstanceId)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)

  // Auto-select first thread when loaded
  useEffect(() => {
    if (threads.length > 0 && !selectedThreadId) {
      setSelectedThreadId(threads[0].id)
    }
  }, [threads, selectedThreadId])

  // Reset selection if selected thread is no longer in list
  useEffect(() => {
    if (selectedThreadId && threads.length > 0 && !threads.find((t) => t.id === selectedThreadId)) {
      setSelectedThreadId(threads[0].id)
    }
  }, [threads, selectedThreadId])

  // Empty state
  if (!isLoading && threads.length === 0) {
    return (
      <div className='h-full flex flex-col'>
        <ConversationHeader
          ticketId={entityInstanceId}
          record={record}
          threadCount={0}
          onRefresh={refresh}
        />
        <EmptyState
          icon={Mail}
          className='h-full flex flex-1 items-center'
          title='No conversations yet'
          description='Link an existing thread or start a new conversation'
        />
      </div>
    )
  }

  return (
    <div className='h-full w-full flex flex-col flex-1'>
      <ConversationHeader
        ticketId={entityInstanceId}
        record={record}
        threadCount={threads.length}
        onRefresh={refresh}
      />

      {/* Thread card scroller (hidden for single thread) */}
      {threads.length > 1 && (
        <TicketThreadScroller
          threads={threads}
          selectedThreadId={selectedThreadId}
          onSelect={setSelectedThreadId}
          ticketId={entityInstanceId}
          onRefresh={refresh}
        />
      )}

      {/* Thread detail view */}
      <div className='flex-1 min-h-0'>
        {selectedThreadId && (
          <ThreadProvider threadId={selectedThreadId}>
            <ThreadDetails />
          </ThreadProvider>
        )}
      </div>
    </div>
  )
}

/**
 * Header with thread count and Link/New actions.
 */
function ConversationHeader({
  ticketId,
  record,
  threadCount,
  onRefresh,
}: {
  ticketId: string
  record?: Record<string, unknown>
  threadCount: number
  onRefresh: () => void
}) {
  return (
    <div className='flex items-center justify-between px-4 py-2 border-b shrink-0'>
      <div className='flex items-center gap-2'>
        <Mail className='size-4 text-muted-foreground' />
        <span className='text-sm font-medium'>Conversation</span>
        {threadCount > 0 && <Badge variant='secondary'>{threadCount}</Badge>}
      </div>
      <div className='flex items-center gap-1'>
        <LinkThreadDialog ticketId={ticketId} onLinked={onRefresh}>
          <Button variant='ghost' size='sm'>
            <Link2 className='size-4' />
            Link
          </Button>
        </LinkThreadDialog>
        <NewThreadForTicketButton ticketId={ticketId} ticket={record} onCreated={onRefresh}>
          <Button variant='ghost' size='sm'>
            <Plus className='size-4' />
            New
          </Button>
        </NewThreadForTicketButton>
      </div>
    </div>
  )
}

/**
 * Horizontal scrollable thread card selector with edge masking.
 */
function TicketThreadScroller({
  threads,
  selectedThreadId,
  onSelect,
  ticketId,
  onRefresh,
}: {
  threads: ThreadMeta[]
  selectedThreadId: string | null
  onSelect: (id: string) => void
  ticketId: string
  onRefresh: () => void
}) {
  const { update } = useThreadMutation()

  const filterConditions: ConditionGroup[] = useMemo(() => [], [])

  return (
    <MailFilterProvider
      value={{
        contextType: 'ticket',
        contextId: ticketId,
        statusSlug: 'open',
        selectedThreadIds: selectedThreadId ? [selectedThreadId] : [],
        viewMode: 'view',
        sortBy: 'newest',
        sortDirection: 'desc',
        filterConditions,
      }}>
      <div className='border-b'>
        <ScrollArea
          orientation='horizontal'
          className='[&_[data-radix-scroll-area-viewport]]:mask-x'>
          <div className='flex gap-2 px-4 py-3'>
            {threads.map((thread) => (
              <div key={thread.id} className='w-[280px] shrink-0 relative group/card'>
                <MailThreadItem
                  threadId={thread.id}
                  basePath=''
                  isSelected={thread.id === selectedThreadId}
                  handleThreadClick={(id) => onSelect(id)}
                />
                <Button
                  variant='ghost'
                  size='icon-xs'
                  className='absolute top-1 right-1 opacity-0 group-hover/card:opacity-100 transition-opacity bg-background/80 hover:bg-destructive hover:text-destructive-foreground'
                  onClick={(e) => {
                    e.stopPropagation()
                    // Optimistic: thread-store flips ticketId=null immediately.
                    // onRefresh re-runs the ticket-side list query to drop the thread.
                    update(thread.id, { ticketId: null })
                    onRefresh()
                  }}>
                  <X className='size-3' />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </MailFilterProvider>
  )
}
