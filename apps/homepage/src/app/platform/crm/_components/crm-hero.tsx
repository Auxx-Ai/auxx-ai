// apps/homepage/src/app/platform/crm/_components/crm-hero.tsx

import Link from 'next/link'
import { SectionBottomFade } from '~/app/_components/main/section-bottom-fade'
import { ShaderGradientBg } from '~/app/_components/shader-gradient-bg'
import { AutoplayVideo } from '~/components/autoplay-video'
import { Button } from '~/components/ui/button'
import { videoUrl } from '~/lib/cdn'
import { config } from '~/lib/config'
import { cn } from '~/lib/utils'

interface CrmHeroProps {
  as?: 'h1' | 'h2'
  /**
   * When set, renders a `SectionBottomFade` that blends the gradient
   * into the next section's color. Drops the hard `border-b` when active.
   */
  bottomFadeColor?: string
}

export default function CrmHero({ as: Heading = 'h1', bottomFadeColor }: CrmHeroProps) {
  return (
    <section className={cn('overflow-hidden relative', !bottomFadeColor && 'border-b')}>
      <ShaderGradientBg preset='hero' palette='dawn' uniforms={{ timeSpeed: 0.7 }} />
      {bottomFadeColor && <SectionBottomFade toColor={bottomFadeColor} />}
      <section className='bg-background/40 relative z-10'>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-0 z-10 mx-1 grid max-w-6xl grid-cols-3 border-x [--color-border:var(--color-border-illustration)] sm:grid-cols-4 md:mx-auto'>
          <div className='h-full border-r border-dashed' />
          <div className='h-full border-r border-dashed' />
          <div className='h-full max-sm:hidden' />
          <div className='h-full border-l border-dashed max-sm:hidden' />
        </div>
        <div className='relative pb-32 pt-24 md:pb-40 md:pt-36 lg:pt-40'>
          <div className='mx-auto w-full px-6 lg:max-w-5xl'>
            <div className='grid items-center max-lg:gap-12 lg:grid-cols-2 '>
              <div className='sm:h-[550px]'>
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
                  src={videoUrl('contact-crm.mp4')}
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>
  )
}
