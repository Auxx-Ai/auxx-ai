// apps/homepage/src/app/platform/dispatch/_components/job-records-section.tsx

import { ListFilter, Tag, Workflow } from 'lucide-react'
import { MockJobRecord } from '../_mocks/job-record-mock'

const beats = [
  {
    icon: Tag,
    name: 'Custom fields',
    description: 'Track equipment, permits, serials — whatever your trade needs.',
  },
  {
    icon: ListFilter,
    name: 'Views & filters',
    description: 'Saved views like Unscheduled, This week, By worker.',
  },
  {
    icon: Workflow,
    name: 'Record rules',
    description: 'Status changes trigger follow-ups automatically.',
  },
]

export default function JobRecordsSection() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Organized job history, finally.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            Every work order is a full record — what was done, what was quoted, who did it, and when
            — searchable forever.
          </p>
        </div>
        <MockJobRecord className='mx-auto mt-12 max-w-lg' />
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
