// apps/homepage/src/app/blog/_components/blog-layout.tsx

import { config } from '~/lib/config'
import { cn } from '~/lib/utils'
import type { Category } from '~/types/blog'
import { BlogFilter } from './blog-filter'

function Decorator({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('p-[0.5px]', className)}>
      <div className='bg-card h-full rounded-md' />
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
        <div className='grid-cols-[1fr_auto_1fr] lg:grid'>
          <Decorator className='max-lg:hidden' />
          <div className='lg:min-w-5xl mx-auto w-full p-[0.5px]'>
            <div className='bg-card h-full rounded-md'>
              <div className='max-w-lg px-6 pb-6 pt-12 md:pt-24'>
                <span className='text-muted-foreground'>Blog</span>
                <h2 className='text-muted-foreground mt-4 text-balance text-4xl font-semibold'>
                  Insights on AI-powered support and growing your Shopify business from{' '}
                  <strong className='text-foreground font-semibold'>{config.shortName}</strong>
                </h2>
              </div>
            </div>
          </div>
          <Decorator className='max-lg:hidden' />
        </div>

        {/* Content row: sidebar + articles */}
        <div className='grid grid-cols-[1fr_auto_1fr]'>
          <Decorator />
          <div className='lg:min-w-5xl mx-auto w-full max-w-5xl p-[0.5px]'>
            <div className='bg-foreground/1 h-full gap-[0.5px] rounded-md lg:grid lg:grid-cols-5'>
              {/* Sidebar */}
              <div className='lg:sticky lg:top-0 lg:grid lg:h-fit lg:min-h-screen lg:grid-rows-[auto_1fr]'>
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
