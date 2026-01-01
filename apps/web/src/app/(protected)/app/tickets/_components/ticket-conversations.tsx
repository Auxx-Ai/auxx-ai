// apps/web/src/app/(protected)/app/tickets/_components/ticket-conversations.tsx

'use client'

import { MessagesSquare } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'
import { TicketReplyItem } from './ticket-reply-item'
import TicketReplyBoxWithProvider from './ticket-reply-box'
import type { RouterOutputs } from '~/trpc/react'

/** Props for TicketConversations component */
interface TicketConversationsProps {
  ticketId: string
  ticket: RouterOutputs['ticket']['byId']
}

/** Main container component for the Conversations tab */
export function TicketConversations({ ticketId, ticket }: TicketConversationsProps) {
  const { data: repliesData, isLoading } = api.ticket.getReplies.useQuery(
    { ticketId },
    { enabled: !!ticketId }
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <EmptyState
          icon={MessagesSquare}
          iconClassName="animate-spin"
          title="Loading conversations"
          description="Fetching email replies..."
        />
      </div>
    )
  }

  const replies = repliesData?.replies || []
  const hasReplies = replies.length > 0

  return (
    <div className="relative h-full w-full flex flex-col flex-1 shrink-0">
      <div className="flex items-center justify-between px-4 sticky top-0 z-1 py-3">
        <h2 className="text-base flex items-center space-x-2 gap-2 text-[14px]">
          <MessagesSquare className="h-5 w-5 text-muted-foreground/50" />
          Email Conversations
        </h2>
      </div>

      {!hasReplies ? (
        <EmptyState
          icon={MessagesSquare}
          className="h-full flex flex-1 items-center"
          title="No email replies yet"
          description="Send your first reply to start the conversation"
        />
      ) : (
        <div className="flex-1 overflow-y-auto pt-0 p-4 h-full space-y-0">
          {replies.map((reply, index) => (
            <TicketReplyItem
              key={reply.id}
              reply={reply}
              isLast={index === replies.length - 1}
            />
          ))}
        </div>
      )}

      <div className="px-4 pt-2 shrink-0">
        <TicketReplyBoxWithProvider
          ticket={ticket}
          onSuccess={() => {}}
        />
      </div>
    </div>
  )
}
