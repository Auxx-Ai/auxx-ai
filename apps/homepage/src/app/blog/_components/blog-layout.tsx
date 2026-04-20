// apps/homepage/src/app/blog/_components/blog-layout.tsx

import { GRADIENT_PALETTES, type GradientPaletteName } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import { config } from '~/lib/config'
import { cn } from '~/lib/utils'
import type { Category } from '~/types/blog'
import { BlogFilter } from './blog-filter'

const BLOG_HERO_PALETTE: GradientPaletteName = 'aurora'

function Decorator({
  className,
  bgClassName = 'bg-card',
}: {
  className?: string
  bgClassName?: string
}) {
  return (
    <div aria-hidden className={cn('p-[0.5px]', className)}>
      <div className={cn('h-full rounded-md', bgClassName)} />
    </div>
  )
}

export function BlogLayout({
  categories,
  children,
}: {
  categories: Category[]
  children: React.ReactNode
}) {
  return (
    <section className='bg-background pb-16'>
      <div className='bg-foreground/9 @container'>
        {/* Header row */}
        <div className='relative overflow-hidden grid-cols-[1fr_auto_1fr] lg:grid'>
          <RandomGradient
            colors={[...GRADIENT_PALETTES[BLOG_HERO_PALETTE]]}
            mode='mesh'
            animated
            driftAmplitude={20}
          />
          <Decorator className='relative z-10 max-lg:hidden' bgClassName='bg-card/40' />
          <div className='bg-card/20 rounded-md lg:min-w-5xl relative z-10 mx-auto w-full p-[0.5px]'>
            <div className=' relative flex h-full min-h-80 flex-col justify-end overflow-hidden rounded-md md:min-h-96'>
              <div className='relative z-10 max-w-lg px-6 pb-12 pt-6 md:pb-16'>
                <span className='text-muted-foreground'>Blog</span>
                <h2 className='text-muted-foreground mt-4 text-balance text-4xl font-semibold'>
                  Insights on AI-powered support and growing your business from{' '}
                  <strong className='text-foreground font-semibold'>{config.shortName}</strong>
                </h2>
              </div>
            </div>
          </div>
          <Decorator className='relative z-10 max-lg:hidden' bgClassName='bg-card/40' />
        </div>

        {/* Content row: sidebar + articles */}
        <div className='grid grid-cols-[1fr_auto_1fr]'>
          <Decorator />
          <div className='lg:min-w-5xl mx-auto w-full max-w-5xl p-[0.5px]'>
            <div className='bg-foreground/1 h-full gap-[0.5px] rounded-md lg:grid lg:grid-cols-5'>
              {/* Sidebar */}
              <div className='lg:sticky lg:top-20 lg:grid lg:h-fit lg:max-h-[calc(100vh-5rem)] lg:grid-rows-[auto_1fr]'>
                <BlogFilter categories={categories} />
                <Decorator className='pl-0 max-lg:hidden' />
              </div>

              {/* Articles */}
              <div className='relative lg:col-span-4'>{children}</div>
            </div>
          </div>
          <Decorator />
        </div>
      </div>
    </section>
  )
}
