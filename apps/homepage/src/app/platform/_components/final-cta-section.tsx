// apps/web/src/app/(website)/features/_components/sections/final-cta-section.tsx

import Link from 'next/link'
import { config } from '@/lib/config'
import { Button } from '~/components/ui/button'

// Enumerates guarantee bullets reinforcing the closing CTA.
const trustBadges = [
  'No credit card required',
  '5-minute setup',
  'Cancel anytime',
  'Free migration support',
  '30-day money-back guarantee',
]

// Renders the closing call-to-action for the features page.
export function FinalCtaSection() {
  const randomTrustBadge = trustBadges[Math.floor(Math.random() * trustBadges.length)]
  return (
    <section className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='mx-auto w-full max-w-5xl px-6 py-24 pb-20'>
            <div className='relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/15 via-background to-muted/40  text-center'>
              <div className='absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_var(--color-primary)/30,_transparent_60%)]' />

              <div className='my-7'>
                <div className='relative mx-auto w-fit bg-gray-950/5 dark:bg-white/5 p-2'>
                  <div
                    aria-hidden='true'
                    className='absolute left-1 top-1 size-[3px] rounded-full bg-gray-950/20 dark:bg-white/20'></div>
                  <div
                    aria-hidden='true'
                    className='absolute right-1 top-1 size-[3px] rounded-full bg-gray-950/20 dark:bg-white/20'></div>
                  <div
                    aria-hidden='true'
                    className='absolute bottom-1 left-1 size-[3px] rounded-full bg-gray-950/20 dark:bg-white/20'></div>
                  <div
                    aria-hidden='true'
                    className='absolute bottom-1 right-1 size-[3px] rounded-full bg-gray-950/20 dark:bg-white/20'></div>
                  <div className='relative flex h-fit items-center gap-2 rounded-full bg-white dark:bg-zinc-900 px-3 py-1 shadow'>
                    <span className='text-title text-sm'>{randomTrustBadge}</span>
                    <span className='block h-3 w-px bg-gray-200 dark:bg-zinc-700'></span>
                    <Link href={config.urls.signup} className='text-info text-sm'>
                      Get Started
                    </Link>
                  </div>
                </div>
              </div>

              <h2 className='text-pretty text-3xl font-semibold sm:text-4xl'>
                Deliver AI-powered support
              </h2>
              <p className='text-muted-foreground mx-auto mt-4 max-w-2xl text-base'>
                Spin up Auxx.ai in minutes. Explore the product tour, automate your top workflows,
                and partner with our onboarding specialists to launch in record time.
              </p>
              <div className='mt-8 flex flex-wrap justify-center gap-4 pb-4'>
                <Button size='lg' asChild>
                  <Link href={config.urls.signup}>Start Building</Link>
                </Button>
                <Button size='lg' variant='outline' className='gap-2' asChild>
                  <Link href={config.urls.demo}>Book a demo</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
