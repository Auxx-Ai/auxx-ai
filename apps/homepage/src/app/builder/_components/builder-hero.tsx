// apps/homepage/src/app/builder/_components/builder-hero.tsx

import Link from 'next/link'
import { TapeStripes } from '~/components/tape-mark'
import { Button } from '~/components/ui/button'
import { BUILDER_APP_URL, SHOTS } from '../_data/content'
import { AppShot } from './app-shot'

/** The hero: the product in one line, its call to action, and the three apps stacked. */
export default function BuilderHero() {
  return (
    <section className='border-b'>
      <div className='bg-muted pt-32 pb-20'>
        <div className='mx-auto max-w-6xl px-6'>
          <div className='grid items-center gap-12 md:grid-cols-[0.9fr_1.1fr]'>
            <div className='max-md:text-center'>
              <span className='text-muted-foreground inline-flex items-center gap-1 text-sm font-medium'>
                <TapeStripes />
                Free · Design · Takeoff · Estimate
              </span>
              <h1 className='mt-4 text-balance text-4xl font-semibold md:text-5xl lg:text-6xl'>
                <span className='text-foreground/50'>Plan it, measure it,</span> price it.
              </h1>
              <p className='text-muted-foreground mb-6 mt-4 max-w-md text-balance text-lg max-md:mx-auto'>
                Design buildings in 3D, mark up and measure your PDF drawings, and turn the
                quantities into estimates and quotes. Three apps that work as one, in your browser.
              </p>

              <Button asChild>
                <Link href={BUILDER_APP_URL}>Open Auxx Builder</Link>
              </Button>
              <Button asChild variant='outline' className='ml-3'>
                <Link href='#workflow'>See how it works</Link>
              </Button>

              <div className='mt-12 grid max-w-sm grid-cols-2 max-md:mx-auto'>
                <div className='space-y-2 *:block'>
                  <span className='text-lg font-semibold'>
                    3 <span className='text-muted-foreground text-lg'>apps</span>
                  </span>
                  <p className='text-muted-foreground text-balance text-sm'>
                    <strong className='text-foreground font-medium'>One product</strong>: design,
                    takeoff and estimating.
                  </p>
                </div>
                <div className='space-y-2 *:block'>
                  <span className='text-lg font-semibold'>
                    $0 <span className='text-muted-foreground text-lg'>to start</span>
                  </span>
                  <p className='text-muted-foreground text-balance text-sm'>
                    <strong className='text-foreground font-medium'>Free</strong>, no install and no
                    credit card.
                  </p>
                </div>
              </div>
            </div>

            <div className='relative aspect-[5/4] w-full'>
              <AppShot
                app='estimator'
                shot={SHOTS.estimatorBound}
                className='absolute top-0 right-0 w-[72%] opacity-90'
              />
              <AppShot
                app='pdf'
                shot={SHOTS.pdfMeasure}
                className='absolute top-[14%] right-[10%] w-[72%]'
              />
              <AppShot
                app='builder'
                shot={SHOTS.builderIsometric}
                className='absolute bottom-0 left-0 w-[78%]'
                priority
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
