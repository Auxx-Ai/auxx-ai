// apps/web/src/app/(protected)/app/tickets/_components/ticket-reply-item.tsx

'use client'

import { formatDistanceToNowStrict } from 'date-fns'
import { cn } from '@auxx/ui/lib/utils'
import { getInitialsFromName } from '@auxx/lib/utils'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { sanitizeHtml } from '~/lib/sanitize'

/** Props for TicketReplyItem component */
interface TicketReplyItemProps {
  reply: {
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
      email: string | null
      image: string | null
    } | null
  }
  isLast?: boolean
}

/** Display a single reply in the conversation thread */
export function TicketReplyItem({ reply, isLast = false }: TicketReplyItemProps) {
  const timestamp =
    typeof reply.createdAt === 'string' ? new Date(reply.createdAt) : reply.createdAt

  const initials = reply.isFromCustomer
    ? reply.senderEmail?.slice(0, 2).toUpperCase() || 'CU'
    : getInitialsFromName(reply.createdBy?.name || null) || 'AG'

  const iconColor = reply.isFromCustomer
    ? 'bg-info text-info-foreground'
    : 'bg-success text-success-foreground'

  const directionIcon = reply.isFromCustomer ? ArrowDown : ArrowUp

  return (
    <div
      className={cn(
        'relative pb-6 last:pb-0',
        // Timeline connector line
        'before:absolute before:inset-y-0 before:left-4.5 before:w-px before:bg-primary-300 before:z-0',
        isLast && 'before:hidden'
      )}>
      <div
        className={cn(
          'relative z-1 flex ps-1 pe-2 py-1 gap-2',
          'bg-illustration ring-border-illustration',
          'origin-bottom rounded-2xl border border-transparent shadow shadow-black/10 ring-1',
          'transition-all duration-300'
        )}>
        {/* Icon */}
        <div
          className={cn(
            'size-6 border border-black/10 dark:border-white/10 rounded-lg',
            'flex items-center justify-center shrink-0',
            'group-hover:bg-secondary transition-colors overflow-hidden',
            iconColor
          )}>
          <span className="text-xs font-semibold">{initials}</span>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            {/* Event Description */}
            <div className="text-[14px] text-primary-400 dark:text-primary-500">
              {/* Email metadata */}
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">
                  {reply.isFromCustomer
                    ? reply.senderEmail
                    : reply.createdBy?.name || reply.createdBy?.email}
                </span>
                <span className="text-xs text-muted-foreground">→</span>
                <span className="text-xs text-muted-foreground">{reply.recipientEmail}</span>
                {reply.ccEmails && reply.ccEmails.length > 0 && (
                  <>
                    <span className="text-xs text-muted-foreground">•</span>
                    <span className="text-xs text-muted-foreground">
                      Cc: {reply.ccEmails.join(', ')}
                    </span>
                  </>
                )}
              </div>

              {/* Reply content */}
              <div
                className="prose prose-sm dark:prose-invert max-w-none mt-2"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(reply.content) }}
              />
            </div>

            {/* Timestamp */}
            <div className="pt-1 shrink-0">
              <div className="shrink-0 whitespace-nowrap text-xs text-primary-muted">
                {formatDistanceToNowStrict(timestamp, { addSuffix: true })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
