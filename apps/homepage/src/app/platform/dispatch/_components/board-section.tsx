// apps/homepage/src/app/platform/dispatch/_components/board-section.tsx

import { BellRing, CalendarRange, MousePointerClick } from 'lucide-react'
import { MockMiniBoard } from '../_mocks/board-mock'

const beats = [
  {
    icon: MousePointerClick,
    name: 'Drag to schedule',
    description:
      'Availability and time off shade automatically — you can only drop where a worker is free.',
  },
  {
    icon: CalendarRange,
    name: 'Day, week, month',
    description:
      "Zoom out to plan tomorrow's crew or the whole season, then back in to move one job.",
  },
  {
    icon: BellRing,
    name: 'Dispatch = notified',
    description: 'The worker gets it in-app and by email the moment you dispatch. No phone tag.',
  },
]

const ROWS = [
  {
    worker: 'Marcus T.',
    tone: 'sky' as const,
    chips: [
      { label: 'Panel inspection', start: 1, span: 3, tone: 'sky' as const },
      { label: 'Furnace tune-up', start: 6, span: 4, tone: 'emerald' as const },
    ],
  },
  {
    worker: 'Dana K.',
    tone: 'emerald' as const,
    chips: [
      { label: 'Drain clearing', start: 2, span: 3, tone: 'amber' as const },
      { label: 'AC compressor swap', start: 8, span: 4, tone: 'sky' as const },
    ],
  },
  {
    worker: 'Luis R.',
    tone: 'amber' as const,
    chips: [
      { label: 'Quarterly treatment', start: 1, span: 4, tone: 'violet' as const },
      { label: 'Water heater install', start: 7, span: 3, tone: 'emerald' as const },
    ],
  },
  {
    worker: 'Priya S.',
    tone: 'violet' as const,
    chips: [{ label: 'Drain clearing', start: 5, span: 4, tone: 'amber' as const }],
  },
]

export default function BoardSection() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            One board for the whole day.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            Drag a job onto a worker&apos;s timeline — they&apos;re notified in-app and by email the
            moment you dispatch.
          </p>
        </div>
        <MockMiniBoard rows={ROWS} className='mx-auto mt-12 max-w-3xl' />
        <ul className='mx-auto mt-12 grid max-w-4xl gap-x-6 gap-y-8 sm:grid-cols-3'>
          {beats.map((beat) => (
            <li key={beat.name} className='space-y-2'>
              <beat.icon className='text-muted-foreground size-5' />
              <div className='text-foreground font-medium'>{beat.name}</div>
              <p className='text-muted-foreground text-sm'>{beat.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
