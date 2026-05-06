// apps/homepage/src/app/platform/ai/_mocks/mock-blocks/thread-list-block.tsx

'use client'

import { Mail } from 'lucide-react'
import { motion } from 'motion/react'
import type { ThreadRow } from '../use-kopilot-story'
import { MockBlockCard } from './block-card'

/**
 * Visual port of `apps/web/src/components/kopilot/ui/blocks/thread-list-block.tsx`.
 * Renders a static list of threads — no `useThread` data fetching.
 */
export function MockThreadListBlock({ rows }: { rows: ThreadRow[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className='not-prose my-2'>
      <MockBlockCard
        indicator={<Mail className='size-3 text-muted-foreground' />}
        primaryText='Threads'
        secondaryText={<span className='text-xs text-muted-foreground'>{rows.length}</span>}>
        <div className='divide-y divide-border'>
          {rows.map((row, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 22,
                delay: Math.min(i * 0.04, 0.3),
              }}>
              <Row row={row} />
            </motion.div>
          ))}
        </div>
      </MockBlockCard>
    </motion.div>
  )
}

function Row({ row }: { row: ThreadRow }) {
  return (
    <div className='flex w-full items-start gap-3 px-2 py-2 text-left text-sm'>
      {row.unread && <span className='mt-1.5 size-2 shrink-0 rounded-full bg-primary' />}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='truncate font-medium'>{row.subject}</span>
          {row.status && (
            <span className='shrink-0 rounded border px-1 text-[10px] uppercase text-muted-foreground'>
              {row.status}
            </span>
          )}
        </div>
        <div className='mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground'>
          {row.sender && <span className='truncate'>{row.sender}</span>}
          {row.age && (
            <>
              {row.sender && <span>·</span>}
              <span className='shrink-0'>{row.age}</span>
            </>
          )}
          {row.messageCount != null && (
            <>
              <span>·</span>
              <span className='flex shrink-0 items-center gap-0.5'>
                <Mail className='size-3' />
                {row.messageCount}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
