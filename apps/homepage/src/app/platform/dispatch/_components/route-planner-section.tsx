// apps/homepage/src/app/platform/dispatch/_components/route-planner-section.tsx

import { CheckCheck, GripVertical, Route } from 'lucide-react'
import { MockRoutePlanner } from '../_mocks/route-map-mock'

const beats = [
  {
    icon: Route,
    name: 'Suggested routes',
    description: 'A sensible stop order per worker, per day.',
  },
  {
    icon: GripVertical,
    name: 'Drag to change it',
    description: 'Reorder stops or hand one to another worker.',
  },
  {
    icon: CheckCheck,
    name: 'Apply times',
    description: 'Nothing moves on the schedule until you say so.',
  },
]

export default function RoutePlannerSection() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Routes that plan themselves.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            Suggested stop order per worker, drag to reorder or reassign, then apply the times back
            to the board.
          </p>
        </div>
        <MockRoutePlanner className='mx-auto mt-12 max-w-5xl text-left' />
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
