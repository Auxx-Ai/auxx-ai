// apps/homepage/src/app/blog/_components/post-grid.tsx

import type { BlogPost } from '~/types/blog'
import { PostCard } from './post-card'

export function PostGrid({ posts }: { posts: BlogPost[] }) {
  return (
    <div className='mx-auto max-w-5xl px-6'>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </div>
  )
}
