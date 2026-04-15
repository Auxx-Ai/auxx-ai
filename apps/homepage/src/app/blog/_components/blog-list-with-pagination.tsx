// apps/homepage/src/app/blog/_components/blog-list-with-pagination.tsx

'use client'

import { useState } from 'react'
import { Button } from '~/components/ui/button'
import type { BlogPost } from '~/types/blog'
import { PostGrid } from './post-grid'

const PAGE_SIZE = 12

export function BlogListWithPagination({ posts }: { posts: BlogPost[] }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const hasMore = visibleCount < posts.length

  return (
    <>
      <PostGrid posts={posts.slice(0, visibleCount)} />
      {hasMore && (
        <div className='bg-card rounded-md p-6 text-center'>
          <Button
            onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
            variant='outline'
            size='lg'>
            Load More
          </Button>
        </div>
      )}
    </>
  )
}
