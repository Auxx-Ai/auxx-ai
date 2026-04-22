// apps/web/src/components/mail/mail-contact/mail-contact-thread-item.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNowStrict } from 'date-fns'
import type React from 'react'
import { useCallback, useMemo } from 'react'
import { useThread } from '~/components/threads/hooks/use-thread'
import type { ThreadMeta } from '~/components/threads/store'
import { getIntegrationIcon } from '../mail-status-config'

interface MailThreadItemProps {
  threadId: string
  onOpen?: (threadId: string) => void
}

/** Displays a single thread preview inside the contact mail view. */
export function MailContactThreadItem({ threadId, onOpen }: MailThreadItemProps) {
  const { thread, isLoading, isNotFound } = useThread({ threadId })

  if (isNotFound) return null
  if (!thread) return isLoading ? <MailContactThreadItemSkeleton /> : null

  return <MailContactThreadItemContent item={thread} onOpen={onOpen} />
}

function MailContactThreadItemContent({
  item,
  onOpen,
}: {
  item: ThreadMeta
  onOpen?: (threadId: string) => void
}) {
  const handleClick = useCallback(
    (_event: React.MouseEvent) => {
      onOpen?.(item.id)
    },
    [item.id, onOpen]
  )

  const formattedDate = useMemo(() => {
    return item.lastMessageAt
      ? formatDistanceToNowStrict(new Date(item.lastMessageAt), { addSuffix: false })
      : ''
  }, [item.lastMessageAt])

  /** Message count display for context */
  const messageCountText = useMemo(() => {
    const count = item.messageCount ?? 0
    return count === 1 ? '1 message' : `${count} messages`
  }, [item.messageCount])

  return (
    <button
      className={cn(
        'group relative flex w-full flex-col items-start gap-1 rounded-lg border bg-background px-6 py-3 text-left text-sm shadow-xs transition-all duration-100 ease-in-out active:cursor-grabbing dark:bg-slate-700'
      )}
      onClick={handleClick}
      type='button'>
      {/* Unread indicator dot */}
      {item.isUnread && (
        <div
          className={cn('absolute left-2 top-5 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-500')}
          aria-label='Unread message'
        />
      )}
      {/* Content */}
      <div className='flex w-full flex-col gap-1'>
        <div className='flex items-center'>
          {/* Integration icon and message count */}
          <div className='flex shrink-0 grow items-center gap-1 overflow-hidden'>
            <div className='flex rounded-full border p-0.5 text-blue-500 group-aria-selected:text-background'>
              {getIntegrationIcon(item.integrationProvider)}
            </div>
            <div className='flex grow items-center gap-2 overflow-hidden'>
              <span className={cn('truncate text-xs text-muted-foreground')}>
                {messageCountText}
              </span>
            </div>
          </div>
          {/* Date */}
          <div className={cn('ml-auto shrink-0 whitespace-nowrap pl-2 text-xs')}>
            {formattedDate}
          </div>
        </div>
        {/* Subject */}
        <div className='grid-auto-cols-[minmax(auto,max-content)] grid flex-1 grid-flow-col grid-cols-[auto] items-center gap-1'>
          <div className={cn('truncate text-xs font-medium')}>{item.subject || '(no subject)'}</div>
          <div>
            <div className='flex items-center justify-end gap-1 overflow-hidden'>
              {item.tags?.length > 0 && item.tags.map((tag) => getTagForThread(tag))}
            </div>
          </div>
        </div>
      </div>
    </button>
  )
}

function MailContactThreadItemSkeleton() {
  return (
    <div className='flex w-full flex-col gap-2 rounded-lg border bg-background px-6 py-3 shadow-xs dark:bg-slate-700'>
      <div className='flex items-center justify-between'>
        <Skeleton className='h-3 w-24' />
        <Skeleton className='h-3 w-12' />
      </div>
      <Skeleton className='h-3 w-2/3' />
    </div>
  )
}

/** Renders a tag badge for thread display. */
function getTagForThread(tag: ThreadMeta['tags'][number]): React.ReactNode {
  return (
    <div
      key={tag.id}
      className='flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-[5px] border px-[3px] py-px text-xs text-[#4B5563] group-aria-selected:text-background/80'>
      {tag.tag_emoji} {tag.title}
    </div>
  )
}
