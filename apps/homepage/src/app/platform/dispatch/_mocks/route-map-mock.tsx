// apps/homepage/src/app/platform/dispatch/_mocks/route-map-mock.tsx

import { GripVertical, MapPin } from 'lucide-react'
import { cn } from '~/lib/utils'

interface PinProps {
  left: number
  top: number
  tone: 'sky' | 'amber'
  number: number
}

function Pin({ left, top, tone, number }: PinProps) {
  return (
    <span
      className={cn(
        'ring-background absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2',
        tone === 'sky' ? 'bg-sky-500' : 'bg-amber-500'
      )}
      style={{ left: `${left}%`, top: `${top}%` }}>
      {number}
    </span>
  )
}

const ROUTES = [
  {
    initials: 'DK',
    tone: 'sky' as const,
    label: 'Dana K. · 3 stops · 38 mi',
    stops: [
      { time: '9:00', name: 'Nguyen residence' },
      { time: '11:15', name: 'Lakeside Dental' },
      { time: '1:45', name: 'Mercer St Bakery' },
    ],
  },
  {
    initials: 'MT',
    tone: 'amber' as const,
    label: 'Marcus T. · 2 stops · 21 mi',
    stops: [
      { time: '8:30', name: 'Hilltop Cafe' },
      { time: '11:00', name: 'Hawthorne Apts' },
    ],
  },
]

/**
 * A route-planning map: a faint street grid, dashed suggested routes for two
 * workers connecting numbered stop pins, and a reorderable stop list panel —
 * echoing the product's route planner.
 */
export function MockRouteMap({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-4 lg:flex-row', className)}>
      <div className='bg-muted/50 ring-foreground/10 relative aspect-[16/10] flex-1 overflow-hidden rounded-xl ring-1'>
        <div
          aria-hidden
          className='absolute inset-0 bg-[repeating-linear-gradient(0deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_32px),repeating-linear-gradient(90deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_32px)] opacity-[0.06]'
        />
        <svg
          aria-hidden
          viewBox='0 0 100 100'
          preserveAspectRatio='none'
          className='absolute inset-0 h-full w-full'>
          <polyline
            points='8,82 8,60 28,60 28,30 52,30 52,18 78,18'
            className='fill-none stroke-sky-500'
            strokeWidth='2'
            vectorEffect='non-scaling-stroke'
            strokeLinejoin='round'
            strokeLinecap='round'
            strokeDasharray='1.4 1'
            opacity='0.7'
          />
          <polyline
            points='8,82 20,82 20,20 44,20 44,68'
            className='fill-none stroke-amber-500'
            strokeWidth='2'
            vectorEffect='non-scaling-stroke'
            strokeLinejoin='round'
            strokeLinecap='round'
            strokeDasharray='1.4 1'
            opacity='0.7'
          />
        </svg>
        <span
          className='bg-foreground/10 ring-background text-muted-foreground absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full ring-2'
          style={{ left: '8%', top: '82%' }}>
          <MapPin className='size-3.5' />
        </span>
        <Pin left={28} top={60} tone='sky' number={1} />
        <Pin left={52} top={30} tone='sky' number={2} />
        <Pin left={78} top={18} tone='sky' number={3} />
        <Pin left={20} top={20} tone='amber' number={1} />
        <Pin left={44} top={68} tone='amber' number={2} />
      </div>

      <div className='w-full shrink-0 lg:w-56'>
        <div className='bg-card ring-foreground/10 flex h-full flex-col rounded-xl border border-transparent p-3 shadow-xl shadow-black/5 ring-1'>
          {ROUTES.map((route) => (
            <div key={route.initials} className='not-first:mt-3 not-first:border-t not-first:pt-3'>
              <div className='flex items-center gap-1.5 px-1 pb-2'>
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold',
                    route.tone === 'sky'
                      ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  )}>
                  {route.initials}
                </span>
                <span className='truncate text-xs font-medium'>{route.label}</span>
              </div>
              <ul className='divide-border/70 divide-y'>
                {route.stops.map((stop) => (
                  <li key={stop.name} className='flex items-center gap-2 py-1.5'>
                    <GripVertical className='text-muted-foreground/40 size-3 shrink-0' />
                    <span className='text-muted-foreground w-10 shrink-0 text-[10px]'>
                      {stop.time}
                    </span>
                    <span className='truncate text-xs'>{stop.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button
            type='button'
            className='bg-foreground text-background mt-auto w-full rounded-md py-1.5 text-[11px] font-medium'>
            Apply times to schedule
          </button>
        </div>
      </div>
    </div>
  )
}
