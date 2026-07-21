// apps/homepage/src/app/platform/dispatch/_components/worker-section.tsx

import { Calendar, Camera, MoveRight } from 'lucide-react'
import { MockWorkerPhone } from '../_mocks/worker-phone-mock'

const beats = [
  {
    icon: MoveRight,
    name: 'One tap forward',
    description: 'En route → On site → Done, and the board updates live.',
  },
  {
    icon: Camera,
    name: 'Proof of work',
    description: 'Completion notes, photos, and quality checklists on every visit.',
  },
  {
    icon: Calendar,
    name: 'Their own schedule',
    description: 'Each worker sees their day; the office keeps the full board.',
  },
]

export default function WorkerSection() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='grid items-center gap-12 lg:grid-cols-2 lg:gap-16'>
          <div>
            <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
              Your crew's whole day, on their phone.
            </h2>
            <p className='text-muted-foreground mt-4 text-balance text-lg'>
              Workers log in on mobile web — no app store, no extra software — and advance the job
              as they go.
            </p>
            <ul className='mt-10 space-y-6'>
              {beats.map((beat) => (
                <li key={beat.name} className='flex gap-3.5'>
                  <beat.icon className='text-muted-foreground size-5 shrink-0' />
                  <div>
                    <div className='text-foreground font-medium'>{beat.name}</div>
                    <p className='text-muted-foreground mt-1 text-sm'>{beat.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <MockWorkerPhone className='order-first lg:order-none' />
        </div>
      </div>
    </section>
  )
}
