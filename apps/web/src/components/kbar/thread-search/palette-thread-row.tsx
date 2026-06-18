// apps/web/src/components/kbar/thread-search/palette-thread-row.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNowStrict } from 'date-fns'
import DOMPurify from 'dompurify'
import { memo, useMemo } from 'react'
import { getIntegrationIcon } from '~/components/mail/mail-status-config'
import { useMessage, useMessageParticipants } from '~/components/threads/hooks'
import type { ThreadMeta } from '~/components/threads/store'

interface PaletteThreadRowProps {
  thread: ThreadMeta
  isSelected: boolean
  onSelect: () => void
}

/**
 * Lightweight, presentation-only thread row for the palette's thread reader
 * (friction #2 in the plan). Unlike the inbox's `MailThreadItem`, it pulls in
 * none of the selection store / keyboard-nav / mutations / drag machinery —
 * none of which belong in the palette. It reads the same batched, store-cached
 * data hooks the inbox row uses (`useMessage` + `useMessageParticipants`), so
 * the per-row cost matches the inbox's existing cost.
 */
export const PaletteThreadRow = memo(function PaletteThreadRow({
  thread,
  isSelected,
  onSelect,
}: PaletteThreadRowProps) {
  const { message: latestMessage } = useMessage({
    messageId: thread.latestMessageId,
    enabled: !!thread.latestMessageId,
  })
  const { from: sender } = useMessageParticipants(latestMessage?.participants ?? [])

  const senderName = sender?.displayName ?? 'Unknown'

  const formattedDate = useMemo(
    () =>
      thread.lastMessageAt
        ? formatDistanceToNowStrict(new Date(thread.lastMessageAt), { addSuffix: false })
        : '',
    [thread.lastMessageAt]
  )

  const snippet = useMemo(() => {
    if (typeof window !== 'undefined' && latestMessage?.snippet) {
      return DOMPurify.sanitize(latestMessage.snippet, { USE_PROFILES: { html: true } })
    }
    return latestMessage?.snippet ?? ''
  }, [latestMessage?.snippet])

  return (
    <button
      type='button'
      id={`palette-thread-${thread.id}`}
      onClick={onSelect}
      onFocus={onSelect}
      aria-selected={isSelected}
      className={cn(
        'group relative flex w-full flex-col items-start gap-1 rounded-lg border bg-background px-3 py-2.5 text-left text-sm transition-colors',
        'hover:bg-accent hover:text-accent-foreground dark:bg-[#2c313c] dark:border-[#1e2227]',
        isSelected &&
          'bg-info text-background hover:bg-info-100! border-info/50 dark:bg-info dark:hover:bg-info-100'
      )}>
      {thread.isUnread && (
        <span
          className={cn(
            'absolute left-1.5 top-3.5 size-2 rounded-full bg-blue-500',
            isSelected && 'bg-white'
          )}
          aria-label='Unread message'
        />
      )}
      <div className='flex w-full items-center gap-2'>
        <div
          className={cn(
            'flex-none rounded-full border p-0.5 text-blue-500',
            isSelected && 'border-background/40 text-background'
          )}>
          {getIntegrationIcon(thread.integrationProvider)}
        </div>
        <div className='min-w-0 flex-1 truncate font-semibold group-aria-selected:text-white'>
          {senderName}
        </div>
        <span className='shrink-0 whitespace-nowrap text-xs text-muted-foreground group-aria-selected:text-background/60'>
          {formattedDate}
        </span>
      </div>
      <div className='w-full truncate text-xs font-medium group-aria-selected:text-background/80'>
        {thread.subject || '(no subject)'}
      </div>
      {snippet && (
        <div
          className='line-clamp-1 w-full break-words text-xs text-muted-foreground group-aria-selected:text-background/50'
          dangerouslySetInnerHTML={{ __html: snippet }}
        />
      )}
    </button>
  )
})
