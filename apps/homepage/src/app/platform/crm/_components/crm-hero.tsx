// apps/homepage/src/app/platform/crm/_components/crm-hero.tsx

import Link from 'next/link'
import { AutoplayVideo } from '~/components/autoplay-video'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'

export default function CrmHero({ as: Heading = 'h1' }: { as?: 'h1' | 'h2' }) {
  return (
    <section className='overflow-x-hidden relative border-b'>
      <section>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-0 z-10 mx-1 grid max-w-6xl grid-cols-3 border-x [--color-border:var(--color-border-illustration)] sm:grid-cols-4 md:mx-auto'>
          <div className='h-full border-r border-dashed' />
          <div className='h-full border-r border-dashed' />
          <div className='h-full max-sm:hidden' />
          <div className='h-full border-l border-dashed max-sm:hidden' />
        </div>
        <div className='mb:pb-24 relative pb-16 pt-24 md:pt-36 lg:pt-40'>
          <div className='mx-auto w-full px-6 lg:max-w-5xl'>
            <div className='grid items-center max-lg:gap-12 lg:grid-cols-2 '>
              <div className='h-[550px]'>
                <div className='lg:max-w-sm'>
                  <Heading className='text-balance text-4xl font-semibold md:text-5xl'>
                    Know Your Customers, Grow Your Business
                  </Heading>
                  <p className='text-muted-foreground mb-6 mt-4 text-balance text-lg'>
                    Complete customer relationship management that scales with your success.
                  </p>

                  <div className='flex items-center gap-3'>
                    <Button asChild size='sm'>
                      <Link href={config.urls.signup}>Start Building</Link>
                    </Button>
                    <Button asChild size='sm' variant='outline'>
                      <Link href={config.urls.demo}>Request demo</Link>
                    </Button>
                  </div>
                </div>

                <div className='mt-12 grid max-w-sm grid-cols-2'>
                  <div className='space-y-2 *:block'>
                    <span className='text-lg font-semibold'>
                      360 <span className='text-muted-foreground text-lg'>°</span>
                    </span>
                    <p className='text-muted-foreground text-balance text-sm'>
                      <strong className='text-foreground font-medium'>Customer view</strong> with
                      complete history and insights.
                    </p>
                  </div>

                  <div className='space-y-2 *:block'>
                    <span className='text-lg font-semibold'>
                      10 <span className='text-muted-foreground text-lg'>X</span>
                    </span>
                    <p className='text-muted-foreground text-balance text-sm'>
                      <strong className='text-foreground font-medium'>Faster</strong> customer data
                      access and management.
                    </p>
                  </div>
                </div>
              </div>
              <div className='max-lg:max-w-[calc(100vw-3rem)] lg:-mr-6 h-[550px] z-100'>
                <AutoplayVideo
                  autoPlay
                  loop
                  muted
                  className='size-full rounded-xl object-cover shadow-lg'
                  src='/videos/contact-crm.mp4'
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>
  )
}
