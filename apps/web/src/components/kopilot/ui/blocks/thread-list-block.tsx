// apps/web/src/components/kopilot/ui/blocks/thread-list-block.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { formatDistanceToNowStrict } from 'date-fns'
import { Mail } from 'lucide-react'
import { motion } from 'motion/react'
import { useSearchParams } from 'next/navigation'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { ThreadListData } from './block-schemas'

export function ThreadListBlock({ data, skipEntrance }: BlockRendererProps<ThreadListData>) {
  const searchParams = useSearchParams()

  const handleClick = (threadId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('threadId', threadId)
    window.history.pushState(null, '', `?${params.toString()}`)
  }

  return (
    <div className='not-prose my-2'>
      <BlockCard
        data-slot='thread-list-block'
        indicator={<Mail className='size-3 text-muted-foreground' />}
        primaryText='Threads'
        secondaryText={<span className='text-xs text-muted-foreground'>{data.length}</span>}
        hasFooter={false}>
        <div className='divide-y'>
          {data.map((thread, i) => (
            <motion.div
              key={thread.id}
              initial={skipEntrance ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 22,
                delay: skipEntrance ? 0 : Math.min(i * 0.04, 0.3),
              }}>
              <button
                type='button'
                onClick={() => handleClick(thread.id)}
                className='flex w-full items-start gap-3 px-2 py-2 text-left text-sm transition-colors hover:bg-muted/50'>
                {thread.isUnread && (
                  <span className='mt-1.5 size-2 shrink-0 rounded-full bg-primary' />
                )}
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <span className='truncate font-medium'>{thread.subject}</span>
                    <Badge variant='outline' className='shrink-0 text-[10px] uppercase'>
                      {thread.status}
                    </Badge>
                  </div>
                  <div className='mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground'>
                    {thread.sender && <span className='truncate'>{thread.sender}</span>}
                    {thread.lastMessageAt && (
                      <>
                        <span>·</span>
                        <span className='shrink-0'>
                          {formatDistanceToNowStrict(new Date(thread.lastMessageAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </>
                    )}
                    {thread.messageCount != null && (
                      <>
                        <span>·</span>
                        <span className='flex shrink-0 items-center gap-0.5'>
                          <Mail className='size-3' />
                          {thread.messageCount}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            </motion.div>
          ))}
        </div>
      </BlockCard>
    </div>
  )
}
