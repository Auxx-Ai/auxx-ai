// apps/homepage/src/app/platform/sequences/_components/triggers-section.tsx

import { Filter, UserRoundPlus, Zap } from 'lucide-react'
import SequenceRailIllustration from './sequence-rail-illustration'

const capabilities = [
  {
    icon: Zap,
    name: 'Real events, not cron jobs',
    description:
      'Visit scheduled, crew en route, job completed, invoice sent. The event fires, the sequence enrolls the contact — nobody opens a spreadsheet.',
  },
  {
    icon: Filter,
    name: 'Filter who gets in',
    description:
      'Condition groups run once, at enrollment. Only overdue invoices, only first-time customers, only the jobs you actually want followed up.',
  },
  {
    icon: UserRoundPlus,
    name: 'Or enroll them yourself',
    description:
      'Pick contacts from a list, or add someone straight from their record. Up to 50 at a time, into any published sequence.',
  },
]

/**
 * The enrollment story — what starts a sequence and how a run ends — anchored
 * by the vertical rail illustration.
 */
export default function TriggersSection() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-5xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-3xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Nobody has to remember.
          </h2>
          <p className='mt-4 text-balance text-lg text-muted-foreground'>
            A booking, a finished job, a sent invoice — the sequence starts itself, sends on the
            days you picked, and bows out the moment the customer answers.
          </p>
        </div>

        <div className='mt-14 w-full'>
          <SequenceRailIllustration />
        </div>

        <div className='mt-16 grid gap-x-6 gap-y-8 border-t pt-12 sm:grid-cols-3'>
          {capabilities.map((capability) => (
            <div key={capability.name} className='space-y-2'>
              <div className='flex items-center gap-2'>
                <capability.icon className='size-4 fill-foreground/10 text-foreground' />
                <h3 className='text-sm font-medium'>{capability.name}</h3>
              </div>
              <p className='text-sm text-muted-foreground'>{capability.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
