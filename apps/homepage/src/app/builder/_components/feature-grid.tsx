// apps/homepage/src/app/builder/_components/feature-grid.tsx

import { TAPE_ACCENT } from '~/components/tape-mark'
import { FEATURES } from '../_data/content'

/** Capabilities across the three apps, numbered like a tape's track listing. */
export default function FeatureGrid() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>And a lot more.</h2>
        </div>
        <ol className='mt-12 grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-4'>
          {FEATURES.map((feature, index) => (
            <li key={feature.title} className='bg-background p-6'>
              <div className='flex items-center gap-2'>
                <span className='text-muted-foreground font-mono text-xs'>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span
                  aria-hidden
                  className='h-px flex-1'
                  style={{ backgroundColor: TAPE_ACCENT[feature.app], opacity: 0.5 }}
                />
              </div>
              <div className='text-foreground mt-4 font-medium'>{feature.title}</div>
              <p className='text-muted-foreground mt-1 text-sm'>{feature.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
