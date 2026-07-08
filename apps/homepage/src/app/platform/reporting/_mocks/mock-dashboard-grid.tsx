// apps/homepage/src/app/platform/reporting/_mocks/mock-dashboard-grid.tsx
'use client'

import { GripVertical } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { cn } from '~/lib/utils'
import { MockCard } from './mock-card'
import { MockDonut } from './mock-donut'
import { MockKpiTile } from './mock-kpi-tile'
import { MockLineChart } from './mock-line-chart'
import { MockRecordList } from './mock-record-list'
import { AI_IMPACT, AI_RESOLVED_KPI, RECENT_TICKETS, TICKET_STATUS } from './sample-data'

function Widget({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <MockCard
      title={
        <span className='flex items-center justify-between gap-2'>
          {title}
          <GripVertical className='text-muted-foreground/50 size-3.5 opacity-0 transition-opacity group-hover/widget:opacity-100' />
        </span>
      }
      className={cn('group/widget', className)}
      contentClassName='h-full'>
      {children}
    </MockCard>
  )
}

/** Cycles between the product's amber "unsaved changes" pill and the published state. */
function PublishPill() {
  const reducedMotion = useReducedMotion()
  const [published, setPublished] = useState(true)

  useEffect(() => {
    if (reducedMotion) return
    const interval = setInterval(() => setPublished((p) => !p), 2800)
    return () => clearInterval(interval)
  }, [reducedMotion])

  return (
    <AnimatePresence mode='wait' initial={false}>
      <motion.span
        key={String(published)}
        initial={reducedMotion ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
        transition={{ duration: 0.2 }}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium',
          published
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
        )}>
        <span
          className={cn('size-1.5 rounded-full', published ? 'bg-emerald-500' : 'bg-amber-500')}
        />
        {published ? 'Published · v12' : 'Live · unsaved changes'}
      </motion.span>
    </AnimatePresence>
  )
}

const AVATARS = [
  '/images/avatars/carolin.jpg',
  '/images/avatars/luis.jpg',
  '/images/avatars/rey.jpg',
]

interface MockDashboardGridProps {
  /** 'build' shows tabs + drag affordances; 'collaborate' adds the publish pill + viewer avatars */
  variant?: 'build' | 'collaborate'
  className?: string
}

/** A miniature multi-widget dashboard echoing the product's drag-and-resize grid editor. */
export function MockDashboardGrid({ variant = 'build', className }: MockDashboardGridProps) {
  return (
    <div
      className={cn(
        'bg-background/60 ring-border rounded-2xl p-3 shadow-xl shadow-black/10 ring-1 backdrop-blur',
        className
      )}>
      <div className='flex items-center justify-between gap-2 px-1 pb-2'>
        <div className='flex items-center gap-1'>
          {['Overview', 'Team', 'AI'].map((tab, i) => (
            <span
              key={tab}
              className={cn(
                'rounded-md px-2 py-1 text-xs',
                i === 0 ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'
              )}>
              {tab}
            </span>
          ))}
        </div>
        {variant === 'collaborate' ? (
          <div className='flex items-center gap-2'>
            <div className='flex -space-x-1.5'>
              {AVATARS.map((src) => (
                <img
                  key={src}
                  src={src}
                  alt=''
                  className='ring-background size-5 rounded-full object-cover ring-2'
                />
              ))}
            </div>
            <PublishPill />
          </div>
        ) : (
          <span className='bg-foreground text-background rounded-md px-2 py-1 text-[10px] font-medium'>
            Publish
          </span>
        )}
      </div>
      <div className='grid grid-cols-2 gap-2'>
        <Widget title='AI-resolved this week'>
          <MockKpiTile
            label='Tickets'
            value={AI_RESOLVED_KPI.value}
            deltaLabel={AI_RESOLVED_KPI.deltaLabel}
            className='mt-2'
          />
        </Widget>
        <Widget title='Ticket status'>
          <MockDonut
            data={TICKET_STATUS}
            showLegend={false}
            centerValue='68%'
            centerLabel='resolved'
          />
        </Widget>
        <Widget title='AI-resolved rate' className='max-sm:hidden'>
          <MockLineChart
            data={AI_IMPACT}
            xKey='week'
            series={[{ key: 'rate', label: 'AI-resolved %', colorVar: 'report-c4' }]}
            className='mt-2 h-28'
            showTooltip={false}
          />
        </Widget>
        <Widget title='Newest tickets' className='max-sm:hidden'>
          <MockRecordList tickets={RECENT_TICKETS} className='mt-1' />
        </Widget>
      </div>
    </div>
  )
}
