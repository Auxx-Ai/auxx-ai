// apps/homepage/src/app/platform/reporting/_mocks/mock-drill-down.tsx
'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { cn } from '~/lib/utils'
import { MockCard } from './mock-card'
import { MockRecordList } from './mock-record-list'
import { TICKETS_BY_TAG } from './sample-data'

/**
 * Interactive group-by → drill-down mock: click a tag bar and the underlying
 * tickets slide in below, mirroring the product's drill-down to the record
 * drawer.
 */
export function MockDrillDown({ className }: { className?: string }) {
  const [selectedTag, setSelectedTag] = useState(TICKETS_BY_TAG[0].tag)
  const reducedMotion = useReducedMotion()
  const max = Math.max(...TICKETS_BY_TAG.map((t) => t.count))
  const selected = TICKETS_BY_TAG.find((t) => t.tag === selectedTag) ?? TICKETS_BY_TAG[0]

  return (
    <MockCard
      layered
      title='Tickets by tag'
      subtitle='This month · click a tag to drill down'
      className={className}>
      <div className='mt-4 space-y-1.5'>
        {TICKETS_BY_TAG.map((row) => {
          const isSelected = row.tag === selectedTag
          return (
            <button
              key={row.tag}
              type='button'
              onClick={() => setSelectedTag(row.tag)}
              aria-pressed={isSelected}
              className={cn(
                'group grid w-full grid-cols-[4.5rem_1fr_2rem] items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors',
                isSelected ? 'bg-muted/80' : 'hover:bg-muted/50'
              )}>
              <span
                className={cn(
                  'truncate text-xs',
                  isSelected ? 'text-foreground font-medium' : 'text-muted-foreground'
                )}>
                {row.tag}
              </span>
              <span className='bg-muted relative h-3.5 overflow-hidden rounded-sm'>
                <span
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-sm bg-[var(--report-c1)] transition-[width] duration-500',
                    !isSelected && 'opacity-60 group-hover:opacity-80'
                  )}
                  style={{ width: `${(row.count / max) * 100}%` }}
                />
              </span>
              <span className='text-muted-foreground text-right text-xs tabular-nums'>
                {row.count}
              </span>
            </button>
          )
        })}
      </div>

      <div className='border-border/70 mt-4 border-t pt-3'>
        <div className='text-muted-foreground text-[10px] font-medium uppercase tracking-wide'>
          {selected.tag} · {selected.count} tickets
        </div>
        <AnimatePresence mode='wait' initial={false}>
          <motion.div
            key={selected.tag}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}>
            <MockRecordList tickets={selected.tickets} className='mt-1' />
          </motion.div>
        </AnimatePresence>
      </div>
    </MockCard>
  )
}
