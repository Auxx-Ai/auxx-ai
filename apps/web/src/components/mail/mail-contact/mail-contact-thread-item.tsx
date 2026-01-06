// apps/web/src/components/mail/mail-contact/mail-contact-thread-item.tsx
'use client'

import React, { useMemo, useCallback } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { getInitialsFromName } from '@auxx/utils'
import DOMPurify from 'dompurify'
import { cn } from '@auxx/ui/lib/utils'
import { Badge } from '@auxx/ui/components/badge'
import { type ThreadListItem } from '../types'
import { getIntegrationIcon } from '../mail-status-config'

interface MailThreadItemProps {
  item: ThreadListItem
  // isSelected: boolean
}
/** Displays a single thread preview inside the contact mail view. */
export function MailContactThreadItem({ item }: MailThreadItemProps) {
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      console.log('Thread clicked:', item.id)
    },
    [item.id]
  )

  const formattedDate = useMemo(() => {
    return item.lastMessageAt
      ? formatDistanceToNowStrict(new Date(item.lastMessageAt), { addSuffix: false }) // Simpler format
      : ''
  }, [item.lastMessageAt])

  const latestEmail = item.latestMessage ?? item.messages?.[0] ?? null
  const senderName = useMemo(
    () => latestEmail?.from?.name || latestEmail?.from?.identifier || 'Unknown',
    [latestEmail]
  )
  const snippet = useMemo(() => {
    // Sanitize snippet HTML. Ensure DOMPurify runs client-side only.
    if (typeof window !== 'undefined') {
      return DOMPurify.sanitize(latestEmail?.snippet ?? '', { USE_PROFILES: { html: true } })
    }
    return latestEmail?.snippet ?? '' // Fallback for SSR/initial render
  }, [latestEmail?.snippet])

  const sanitizedCommentContent = useMemo(() => {
    // Sanitize comment content to prevent XSS
    if (typeof window !== 'undefined' && item.latestComment?.content) {
      return DOMPurify.sanitize(item.latestComment.content, { USE_PROFILES: { html: true } })
    }
    return item.latestComment?.content ?? ''
  }, [item.latestComment?.content])

  return (
    // Main button element - draggable and clickable
    <button
      className={cn(
        // Base styles
        'group relative flex w-full cursor-grab flex-col items-start gap-1 rounded-lg border bg-background px-6 py-3 text-left text-sm shadow-xs transition-all duration-100 ease-in-out active:cursor-grabbing dark:bg-slate-700'
        // Hover styles (only when not actively selected)
      )}
      onClick={handleClick}
      // Prevent default browser drag behavior which can interfere
      type="button" // Ensure it's treated as a button
    >
      {/* Unread indicator dot */}
      {item.isUnread && (
        <div
          className={cn('absolute left-2 top-5 h-2 w-2 -translate-y-1/2 rounded-full')}
          aria-label="Unread message"
        />
      )}
      {/* Content */}
      <div className="flex w-full flex-col gap-1">
        <div className="flex items-center">
          {/* Sender Name */}
          <div className="flex shrink-0 grow items-center gap-1 overflow-hidden">
            <div className="flex rounded-full border p-0.5 text-blue-500 group-aria-selected:text-background">
              {/* Integration type derived from item.integration.provider */}
              {getIntegrationIcon(item.integration?.provider)}
            </div>
            <div className="flex grow items-center gap-2 overflow-hidden">
              <span className={cn('truncate font-semibold')}>{senderName}</span>
            </div>
          </div>
          {/* Date */}
          <div className={cn('ml-auto shrink-0 whitespace-nowrap pl-2 text-xs')}>
            {formattedDate}
          </div>
        </div>
        {/* Subject */}
        <div className="grid-auto-cols-[minmax(auto,max-content)] grid flex-1 grid-flow-col grid-cols-[auto] items-center gap-1">
          <div className={cn('truncate text-xs font-medium')}>{item.subject || '(no subject)'}</div>
          <div>
            <div className="flex items-center justify-end gap-1 overflow-hidden">
              {item.tags?.length > 0 && item.tags.map((tag) => getTagForThread(tag))}
            </div>
          </div>
        </div>
      </div>
      {/* Snippet */}
      <div
        className={cn('line-clamp-2 w-full break-words text-xs')}
        dangerouslySetInnerHTML={{ __html: snippet }} // Use sanitized snippet
      />
      {item.latestComment && (
        <div className="">
          <div
            className={cn(
              'flex min-w-0 items-center gap-1 rounded-[10px] bg-[rgba(93,105,133,0.18)] pe-2 text-xs group-aria-selected:text-background'
            )}>
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(93,105,133,0.5)] text-xs text-background'
              )}>
              {getInitialsFromName(item.latestComment.createdBy.name)}
            </span>
            <div
              dangerouslySetInnerHTML={{ __html: sanitizedCommentContent }}
            />
          </div>
        </div>
      )}
    </button>
  )
}

/** Renders a tidied badge for a tag in contact thread context. */
function getTagForThread(tag: ThreadListItem['tags'][number]): React.ReactNode {
  const name = tag.title
  // Add logic here to map label names/properties to Badge variants/colors
  return (
    <div
      key={tag.id}
      className={`flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-[5px] border px-[3px] py-px text-xs text-[#4B5563] group-aria-selected:text-background/80`}>
      {tag.emoji} {name}
    </div>
  )
}

// Helper function for rendering label badges (if needed later)
function getBadgeVariantFromLabel(label: { label: { name: string } }): React.ReactNode {
  const name = label.label.name
  // Add logic here to map label names/properties to Badge variants/colors
  return (
    <Badge key={name} variant="outline">
      {name}
    </Badge>
  )
}
// --- END OF FILE ~/components/mail/mail-contact/mail-contact-thread-item.tsx ---
