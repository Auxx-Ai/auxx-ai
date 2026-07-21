// apps/homepage/src/app/industries/_components/industry-workflow.tsx

import type { IndustryVertical } from '../_data/verticals'

export default function IndustryWorkflow({ vertical }: { vertical: IndustryVertical }) {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            How {vertical.proseName} shops run on Auxx.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            Request to quote to dispatch to paid invoice — one record, start to finish.
          </p>
        </div>
        <ol className='mx-auto mt-12 grid max-w-5xl gap-8 sm:grid-cols-2 lg:grid-cols-4'>
          {vertical.workflowSteps.map((step, index) => (
            <li key={step.title} className='space-y-2'>
              <div className='text-muted-foreground/30 text-4xl font-bold'>
                {String(index + 1).padStart(2, '0')}
              </div>
              <div className='text-foreground font-medium'>{step.title}</div>
              <p className='text-muted-foreground text-sm'>{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
