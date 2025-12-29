// apps/web/src/app/(protected)/app/tickets/_components/ticket-conversations-list.tsx

'use client'

import { TicketReplyItem } from './ticket-reply-item'

/** Props for TicketConversationsList component */
interface TicketConversationsListProps {
  ticketId: string
  initialReplies: Array<{
    id: string
    content: string
    createdAt: Date | string
    senderEmail: string | null
    recipientEmail: string | null
    ccEmails: string[] | null
    isFromCustomer: boolean
    createdBy: {
      id: string
      name: string | null
      email: string
      image: string | null
    } | null
  }>
}

/** Display the list of all ticket replies */
export function TicketConversationsList({
  ticketId,
  initialReplies,
}: TicketConversationsListProps) {
  return (
    <div className="space-y-0">
      {initialReplies.map((reply, index) => (
        <TicketReplyItem
          key={reply.id}
          reply={reply}
          isLast={index === initialReplies.length - 1}
        />
      ))}
    </div>
  )
}
