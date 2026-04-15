// apps/homepage/src/app/blog/_components/post-grid.tsx

import type { BlogPost } from '~/types/blog'
import { PostCard } from './post-card'

export function PostGrid({ posts }: { posts: BlogPost[] }) {
  return (
    <div className='grid gap-px sm:grid-cols-2'>
      {posts.map((post, index) => (
        <PostCard key={post.slug} post={post} priority={index === 0} />
      ))}
    </div>
  )
}
