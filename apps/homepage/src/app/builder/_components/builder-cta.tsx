// apps/homepage/src/app/builder/_components/builder-cta.tsx

import Link from 'next/link'
import { TapeBand, TapeMark } from '~/components/tape-mark'
import { Button } from '~/components/ui/button'
import { BUILDER_APP_URL } from '../_data/content'

/** The closing call to action, under one tape band of all three apps. */
export default function BuilderCta() {
  return (
    <section className='border-b'>
      <TapeBand apps={['builder', 'pdf', 'estimator']} className='h-2' />
      <div className='mx-auto max-w-3xl px-6 py-24 text-center'>
        <div className='flex justify-center gap-2'>
          <TapeMark app='builder' className='size-8' />
          <TapeMark app='pdf' className='size-8' />
          <TapeMark app='estimator' className='size-8' />
        </div>
        <h2 className='mt-6 text-balance text-4xl font-semibold md:text-5xl'>
          Plan, measure and price your next project.
        </h2>
        <p className='text-muted-foreground mt-4 text-lg'>Free · No install · No credit card</p>
        <Button asChild size='lg' className='mt-8'>
          <Link href={BUILDER_APP_URL}>Open Auxx Builder</Link>
        </Button>
      </div>
    </section>
  )
}
