// apps/homepage/src/app/blog/_components/blog-filter.tsx

'use client'

import { Rss } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import type { Category } from '~/types/blog'

export function BlogFilter({ categories }: { categories: Category[] }) {
  const pathname = usePathname()
  const router = useRouter()

  const activeCategory =
    pathname === '/blog' ? 'all' : pathname.split('/blog/category/')[1]?.split('/')[0] || 'all'

  const handleClick = (slug: string) => {
    if (slug === 'all') router.push('/blog')
    else router.push(`/blog/category/${slug}`)
  }

  return (
    <div className='mx-auto my-8 max-w-5xl md:px-6'>
      <div className='flex items-center justify-between gap-4'>
        <div
          className='-ml-0.5 flex snap-x snap-mandatory overflow-x-auto py-3 max-md:pl-6'
          role='tablist'
          aria-label='Blog categories'>
          <FilterButton
            category={{ slug: 'all', title: 'All' }}
            activeCategory={activeCategory}
            handleClick={handleClick}
          />
          {categories.map((category) => (
            <FilterButton
              key={category.slug}
              category={category}
              activeCategory={activeCategory}
              handleClick={handleClick}
            />
          ))}
        </div>

        <div className='flex gap-1 max-md:pr-3'>
          <Button size='sm' variant='ghost' asChild aria-label='RSS Feed'>
            <Link href='/blog/rss.xml'>
              <Rss />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

function FilterButton({
  category,
  activeCategory,
  handleClick,
}: {
  category: Category
  activeCategory: string
  handleClick: (slug: string) => void
}) {
  return (
    <button
      type='button'
      onClick={() => handleClick(category.slug)}
      role='tab'
      aria-selected={activeCategory === category.slug}
      className='text-muted-foreground group snap-center px-1 disabled:pointer-events-none disabled:opacity-50'>
      <span
        className={cn(
          'flex w-fit items-center gap-2 rounded-full px-3 py-1 text-sm transition-colors [&>svg]:size-4',
          activeCategory === category.slug
            ? 'bg-foreground ring-foreground/5 text-background font-medium shadow-sm ring-1'
            : 'hover:text-foreground group-hover:bg-foreground/5'
        )}>
        <span className='capitalize'>{category.title}</span>
      </span>
    </button>
  )
}
