// apps/homepage/src/app/platform/reporting/_components/drill-down-section.tsx

import { MockDrillDown } from '../_mocks'

export default function DrillDownSection() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='grid items-center gap-12 lg:grid-cols-2'>
          <div className='lg:max-w-md'>
            <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
              Drill down to the ticket that matters.
            </h2>
            <p className='text-muted-foreground mt-4 text-lg'>
              Every bar, slice, and count is a door. Click any segment of a chart and see exactly
              which tickets, contacts, or companies are behind the number — then open the record
              right there.
            </p>
            <p className='text-muted-foreground mt-4'>
              Group tickets by tag, team, channel, or any custom field. Add a second breakdown when
              one dimension isn't enough. No exports, no pivot tables.
            </p>
          </div>
          <MockDrillDown />
        </div>
      </div>
    </section>
  )
}
