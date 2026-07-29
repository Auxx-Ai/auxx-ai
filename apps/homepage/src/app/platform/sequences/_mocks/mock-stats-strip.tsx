// apps/homepage/src/app/platform/sequences/_mocks/mock-stats-strip.tsx

import { CheckCircle, MailWarning, Play, Reply, UserRound, UserRoundX, XCircle } from 'lucide-react'
import { cn } from '~/lib/utils'
import { MOCK_STATS } from './runs'

const ICONS = [UserRound, Play, CheckCircle, UserRoundX, XCircle, Reply, MailWarning]

/**
 * Static facsimile of `sequence-stats-strip.tsx` — the same seven stats in the
 * same order, laid out as the real `StatCards` does (borderless columns split
 * by `border-l`). The last two collapse below `lg` so the strip never wraps
 * inside the mock browser.
 */
export function MockStatsStrip({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-3 border-b border-mock-window-border sm:grid-cols-5 lg:grid-cols-7',
        className
      )}>
      {MOCK_STATS.map((stat, index) => {
        const Icon = ICONS[index] ?? UserRound
        return (
          <div
            key={stat.label}
            className={cn(
              'px-3 py-2.5',
              index > 0 && 'border-l border-mock-window-border',
              index >= 3 && 'hidden sm:block',
              index >= 5 && 'hidden lg:block'
            )}>
            <div className='flex items-center gap-1.5 text-[11px] font-medium text-mock-window-muted'>
              <Icon className={cn('size-3.5', stat.tone)} />
              <span className='truncate'>{stat.label}</span>
            </div>
            <div className='mt-1 text-lg font-semibold text-mock-window-foreground'>
              {stat.value}
            </div>
          </div>
        )
      })}
    </div>
  )
}
