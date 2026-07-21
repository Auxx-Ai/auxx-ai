// apps/homepage/src/app/platform/dispatch/_components/intake-section.tsx

import { History, Mail, Zap } from 'lucide-react'
import { MockIntakeDialog } from '../_mocks/intake-dialog-mock'

const beats = [
  {
    icon: Zap,
    name: 'Fast entry',
    description: 'A receptionist logs who, what, and where in one dialog — no app switching.',
  },
  {
    icon: Mail,
    name: 'Email becomes a job',
    description: 'A support ticket converts straight to a work order, no retyping.',
  },
  {
    icon: History,
    name: 'History survives',
    description: 'Converted requests stay linked to the job they became.',
  },
]

export default function IntakeSection() {
  return (
    <section className='bg-muted/30 border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='grid items-center gap-12 lg:grid-cols-2'>
          <div className='lg:max-w-md'>
            <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
              Every request lands in one place.
            </h2>
            <p className='text-muted-foreground mt-4 text-lg'>
              Phone call, walk-in, or an email thread — log it in seconds and nothing falls through.
            </p>
            <ul className='mt-8 space-y-6'>
              {beats.map((beat) => (
                <li key={beat.name} className='flex gap-3'>
                  <beat.icon className='text-muted-foreground size-5 shrink-0' />
                  <div>
                    <div className='text-foreground font-medium'>{beat.name}</div>
                    <p className='text-muted-foreground text-sm'>{beat.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <MockIntakeDialog className='mx-auto lg:justify-self-end' />
        </div>
      </div>
    </section>
  )
}
