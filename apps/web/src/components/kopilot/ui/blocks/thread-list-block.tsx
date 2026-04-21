// apps/web/src/components/kopilot/ui/blocks/thread-list-block.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { formatDistanceToNowStrict } from 'date-fns'
import { Mail } from 'lucide-react'
import { motion } from 'motion/react'
import { useSearchParams } from 'next/navigation'
import { useThread } from '~/components/threads/hooks/use-thread'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { ThreadListData, ThreadSnapshotData } from './block-schemas'

export function ThreadListBlock({ data, skipEntrance }: BlockRendererProps<ThreadListData>) {
  const { threadIds, snapshot } = data

  return (
    <div className='not-prose my-2'>
      <BlockCard
        data-slot='thread-list-block'
        indicator={<Mail className='size-3 text-muted-foreground' />}
        primaryText='Threads'
        secondaryText={<span className='text-xs text-muted-foreground'>{threadIds.length}</span>}
        hasFooter={false}>
        <div className='divide-y'>
          {threadIds.map((threadId, i) => (
            <motion.div
              key={threadId}
              initial={skipEntrance ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 22,
                delay: skipEntrance ? 0 : Math.min(i * 0.04, 0.3),
              }}>
              <ThreadListRow threadId={threadId} snapshot={snapshot?.[threadId]} />
            </motion.div>
          ))}
        </div>
      </BlockCard>
    </div>
  )
}

interface ThreadListRowProps {
  threadId: string
  snapshot?: ThreadSnapshotData
}

function ThreadListRow({ threadId, snapshot }: ThreadListRowProps) {
  const searchParams = useSearchParams()
  const { thread, isLoading, isNotFound } = useThread({ threadId })

  const handleClick = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('threadId', threadId)
    window.history.pushState(null, '', `?${params.toString()}`)
  }

  const subject = thread?.subject ?? snapshot?.subject ?? null
  const status = thread?.status
  const sender = snapshot?.sender
  const lastMessageAt =
    (thread?.lastMessageAt instanceof Date
      ? thread.lastMessageAt.toISOString()
      : thread?.lastMessageAt) ?? snapshot?.lastMessageAt
  const isUnread = thread?.isUnread ?? snapshot?.isUnread
  const messageCount = thread?.messageCount
  const showDeleted = !thread && !!snapshot && isNotFound

  if (!thread && !snapshot && isLoading) {
    return <div className='px-2 py-2 text-xs text-muted-foreground'>Loading…</div>
  }

  if (!thread && !snapshot && isNotFound) {
    return (
      <div className='px-2 py-2 text-xs text-muted-foreground'>
        Thread unavailable — <span className='font-mono'>{threadId}</span>
      </div>
    )
  }

  return (
    <button
      type='button'
      onClick={handleClick}
      disabled={showDeleted}
      className='flex w-full items-start gap-3 px-2 py-2 text-left text-sm transition-colors hover:bg-muted/50 disabled:hover:bg-transparent'>
      {isUnread && <span className='mt-1.5 size-2 shrink-0 rounded-full bg-primary' />}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='truncate font-medium'>{subject ?? '(no subject)'}</span>
          {status && (
            <Badge variant='outline' className='shrink-0 text-[10px] uppercase'>
              {status}
            </Badge>
          )}
          {showDeleted && (
            <Badge variant='outline' className='shrink-0 text-[10px] uppercase'>
              Deleted
            </Badge>
          )}
        </div>
        <div className='mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground'>
          {sender && <span className='truncate'>{sender}</span>}
          {lastMessageAt && (
            <>
              {sender && <span>·</span>}
              <span className='shrink-0'>
                {formatDistanceToNowStrict(new Date(lastMessageAt), { addSuffix: true })}
              </span>
            </>
          )}
          {messageCount != null && (
            <>
              <span>·</span>
              <span className='flex shrink-0 items-center gap-0.5'>
                <Mail className='size-3' />
                {messageCount}
              </span>
            </>
          )}
        </div>
      </div>
    </button>
  )
}
