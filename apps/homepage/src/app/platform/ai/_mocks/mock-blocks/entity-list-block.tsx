// apps/homepage/src/app/platform/ai/_mocks/mock-blocks/entity-list-block.tsx

'use client'

import { motion } from 'motion/react'
import { cn } from '~/lib/utils'
import { ENTITY_COLOR_CLASS } from '../mock-app-sidebar'
import type { EntityRow } from '../use-kopilot-story'
import { MockBlockCard } from './block-card'

/**
 * Visual port of `apps/web/src/components/kopilot/ui/blocks/entity-list-block.tsx`
 * + `entity-card-item.tsx`. Reuses the homepage's entity-color tokens for
 * the row badges (matches the real EntityIcon `inverse` variant).
 */
export function MockEntityListBlock({
  title = 'Records',
  rows,
}: {
  title?: string
  rows: EntityRow[]
}) {
  const headerColor = rows[0]?.color ?? 'gray'

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className='not-prose my-2'>
      <MockBlockCard
        indicator={
          <span
            className={cn('size-2 rounded-full', ENTITY_COLOR_CLASS[headerColor].split(' ')[0])}
          />
        }
        primaryText={title}
        secondaryText={<span className='text-xs text-muted-foreground'>{rows.length}</span>}>
        <div className='space-y-2'>
          {rows.map((row, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.92, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{
                type: 'spring',
                stiffness: 500,
                damping: 22,
                delay: Math.min(i * 0.06, 0.4),
              }}>
              <Row row={row} />
            </motion.div>
          ))}
        </div>
      </MockBlockCard>
    </motion.div>
  )
}

function Row({ row }: { row: EntityRow }) {
  return (
    <div className='flex items-center gap-3 rounded-lg px-2 py-2'>
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold',
          ENTITY_COLOR_CLASS[row.color]
        )}>
        {row.code}
      </span>
      <div className='flex min-w-0 flex-1 flex-col text-xs'>
        <div className='flex items-center gap-2'>
          <span className='truncate font-medium text-foreground'>{row.title}</span>
          {row.badge && (
            <span className='shrink-0 rounded border px-1 text-[10px] uppercase text-muted-foreground'>
              {row.badge}
            </span>
          )}
        </div>
        {row.subtitle && <span className='truncate text-muted-foreground'>{row.subtitle}</span>}
        {row.meta && <span className='truncate text-muted-foreground/70'>{row.meta}</span>}
      </div>
    </div>
  )
}
