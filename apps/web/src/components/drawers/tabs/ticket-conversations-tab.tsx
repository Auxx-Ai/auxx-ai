// apps/web/src/components/drawers/tabs/ticket-conversations-tab.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
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
      <ScrollArea className='flex-1'>
        <Section
          title='Email Conversations'
          className='flex flex-col flex-1 min-h-0 w-full [&_[data-slot=section]]:flex-1 [&_[data-slot=section]]:border-b-0 [&_[data-slot=section-content]]:flex-1'
          collapsible={false}
          icon={<MessagesSquare className='size-4 text-muted-foreground/50' />}>
          {!hasReplies ? (
            <EmptyState
              icon={MessagesSquare}
              className='h-full flex flex-1 items-center'
              title='No email replies yet'
              description='Send your first reply to start the conversation'
            />
          ) : (
            <div className='flex-1 pt-0 p-4 h-full space-y-0'>
              {replies.map((reply, index) => (
                <TicketReplyItem
                  key={reply.id}
                  reply={reply}
                  isLast={index === replies.length - 1}
                />
              ))}
            </div>
          )}
        </Section>
      </ScrollArea>

      <div className='px-4 pt-2 shrink-0'>
        <TicketReplyBoxWithProvider ticket={record as any} onSuccess={() => {}} />
      </div>
    </div>
  )
}
