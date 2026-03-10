// apps/web/src/components/drawers/tabs/ticket-conversations-tab.tsx
'use client'

import { MessagesSquare } from 'lucide-react'
import TicketReplyBoxWithProvider from '~/app/(protected)/app/tickets/_components/ticket-reply-box'
import { TicketReplyItem } from '~/app/(protected)/app/tickets/_components/ticket-reply-item'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * TicketConversationsTab - conversations tab for ticket drawer
 * Extracted from ticket-detail-drawer.tsx
 */
export function TicketConversationsTab({ entityInstanceId, record }: DrawerTabProps) {
  const { data: repliesData, isLoading } = api.ticket.getReplies.useQuery(
    { ticketId: entityInstanceId },
    { enabled: !!entityInstanceId }
  )

  if (isLoading) {
    return (
      <div className='flex items-center justify-center h-full w-full'>
        <EmptyState
          icon={MessagesSquare}
          iconClassName='animate-spin'
          title='Loading conversations'
          description='Fetching email replies...'
        />
      </div>
    )
  }

  const replies = repliesData?.replies || []
  const hasReplies = replies.length > 0

  return (
    <div className='relative h-full w-full flex flex-col flex-1 shrink-0'>
      <div className='flex items-center justify-between px-4 sticky top-0 z-1 py-3'>
        <h2 className='text-base flex items-center space-x-2 gap-2 text-[14px]'>
          <MessagesSquare className='h-5 w-5 text-muted-foreground/50' />
          Email Conversations
        </h2>
      </div>

      {!hasReplies ? (
        <EmptyState
          icon={MessagesSquare}
          className='h-full flex flex-1 items-center'
          title='No email replies yet'
          description='Send your first reply to start the conversation'
        />
      ) : (
        <div className='flex-1 overflow-y-auto pt-0 p-4 h-full space-y-0'>
          {replies.map((reply, index) => (
            <TicketReplyItem key={reply.id} reply={reply} isLast={index === replies.length - 1} />
          ))}
        </div>
      )}

      <div className='px-4 pt-2 shrink-0'>
        <TicketReplyBoxWithProvider ticket={record as any} onSuccess={() => {}} />
      </div>
    </div>
  )
}
