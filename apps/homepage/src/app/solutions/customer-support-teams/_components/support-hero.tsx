// apps/web/src/app/(website)/solutions/customer-support-teams/_components/support-hero.tsx

import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { SupportHeroIllustration } from './support-hero-illustration'

export default function HeroSection() {
  return (
    <section className='border-b'>
      <div className='bg-muted py-30 pb-20'>
        <div className='mx-auto max-w-5xl px-6'>
          <div className='grid items-center gap-12 md:grid-cols-2'>
            <div className='max-md:text-center'>
              <span className='text-primary text-sm font-medium'>Support Team Enhancement</span>
              <h1 className='mt-4 text-balance text-4xl font-semibold md:text-5xl lg:text-6xl'>
                Empower Your Customer Support Team with AI
              </h1>
              <p className='text-muted-foreground mb-6 mt-4 max-w-md text-balance text-lg max-md:mx-auto'>
                Supercharge your support team's efficiency with AI that handles routine tasks,
                provides instant answers, and lets agents focus on complex customer needs.
              </p>

              <Button asChild>
                <Link href='/contact'>Start Free Trial</Link>
              </Button>
              <Button asChild variant='outline' className='ml-3'>
                <Link href='/demo'>Try Demo</Link>
              </Button>

              <div className='mt-12 grid max-w-sm grid-cols-2 max-md:mx-auto'>
                <div className='space-y-2 *:block'>
                  <span className='text-lg font-semibold'>
                    75 <span className='text-muted-foreground text-lg'>%</span>
                  </span>
                  <p className='text-muted-foreground text-balance text-sm'>
                    <strong className='text-foreground font-medium'>Agent productivity</strong>{' '}
                    increase with AI assistance.
                  </p>
                </div>

                <div className='space-y-2 *:block'>
                  <span className='text-lg font-semibold'>
                    5 <span className='text-muted-foreground text-lg'>X</span>
                  </span>
                  <p className='text-muted-foreground text-balance text-sm'>
                    <strong className='text-foreground font-medium'>Faster resolution</strong> with
                    instant knowledge access.
                  </p>
                </div>
              </div>
            </div>

            <SupportHeroIllustration />
          </div>
        </div>
      </div>
    </section>
  )
}
