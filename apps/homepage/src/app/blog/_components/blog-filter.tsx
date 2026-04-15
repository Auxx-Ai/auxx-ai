// apps/homepage/src/app/blog/_components/blog-filter.tsx

'use client'

import { usePathname, useRouter } from 'next/navigation'
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
    <div className='pb-[0.5px] pr-[0.5px] max-lg:w-screen'>
      <div className='bg-card/75 lg:bg-card rounded-md md:px-6'>
        <div
          className='-ml-0.5 flex py-3 max-lg:snap-x max-lg:snap-mandatory max-lg:overflow-x-auto max-md:px-6 lg:flex-col lg:py-5'
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
      className='text-muted-foreground group snap-center max-lg:px-1 lg:py-1'>
      <span
        className={cn(
          'flex w-fit items-center gap-2 rounded-md px-3 py-1 text-sm transition-colors [&>svg]:size-4',
          activeCategory === category.slug
            ? 'bg-card ring-foreground/5 text-primary font-medium shadow-sm ring-1'
            : 'hover:text-foreground group-hover:bg-foreground/5'
        )}>
        <span className='capitalize'>{category.title}</span>
      </span>
    </button>
  )
}
