// apps/homepage/src/app/platform/data-model/_components/data-model-hero.tsx

import { GRADIENT_PALETTES } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import Link from 'next/link'
import { AutoplayVideo } from '~/components/autoplay-video'
import { Button } from '~/components/ui/button'
import { videoUrl } from '~/lib/cdn'
import { config } from '~/lib/config'

export default function DataModelHero({ as: Heading = 'h1' }: { as?: 'h1' | 'h2' }) {
  return (
    <section className='overflow-hidden relative border-b'>
      <RandomGradient colors={[...GRADIENT_PALETTES.dawn]} mode='mesh' animated blur={10} />
      <section className='bg-background/40 relative z-10'>
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
              <div className='sm:h-[550px]'>
                <div className='lg:max-w-sm'>
                  <Heading className='text-balance text-4xl font-semibold md:text-5xl'>
                    Your data model. Two ways to feed AI.
                  </Heading>
                  <p className='text-muted-foreground mb-6 mt-4 text-balance text-lg'>
                    Author rich knowledge base articles or upload existing docs. Auxx turns both
                    into grounded answers for your customers and your team.
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
                      4 <span className='text-muted-foreground text-lg'>+</span>
                    </span>
                    <p className='text-muted-foreground text-balance text-sm'>
                      <strong className='text-foreground font-medium'>Source formats</strong>{' '}
                      including PDF, DOCX, HTML, and plain text.
                    </p>
                  </div>

                  <div className='space-y-2 *:block'>
                    <span className='text-lg font-semibold'>
                      1 <span className='text-muted-foreground text-lg'>×</span>
                    </span>
                    <p className='text-muted-foreground text-balance text-sm'>
                      <strong className='text-foreground font-medium'>Source of truth</strong>{' '}
                      shared by your portal and every AI reply.
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
                  src={videoUrl('data-model.mp4')}
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>
  )
}
