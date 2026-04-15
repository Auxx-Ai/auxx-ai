// apps/homepage/src/app/blog/_components/post-card.tsx

import { ChevronRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { formatDate } from '~/lib/format-date'
import type { BlogPost } from '~/types/blog'

export function PostCard({ post, priority }: { post: BlogPost; priority?: boolean }) {
  return (
    <article className='bg-card hover:bg-card/75 group relative flex flex-col space-y-4 rounded-md p-6 duration-200'>
      <div className='before:border-foreground/15 before:inset-ring-1 before:inset-ring-background/10 relative aspect-video overflow-hidden rounded-[10px] shadow-md shadow-black/10 before:absolute before:inset-0 before:rounded-[10px] before:border'>
        <Image
          src={post.image}
          alt={post.title}
          width={6394}
          height={4500}
          className='size-full object-cover'
          sizes='(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw'
          priority={priority}
        />
      </div>

      <time
        className='text-muted-foreground block text-sm'
        dateTime={new Date(post.date).toISOString()}>
        {formatDate(post.date)}
      </time>

      <h2 className='text-foreground font-semibold'>
        <Link href={`/blog/${post.slug}`} className='before:absolute before:inset-0'>
          {post.title}
        </Link>
      </h2>
      <p className='text-muted-foreground'>{post.description}</p>

      <div className='mt-auto grid grid-cols-[1fr_auto] items-end gap-2 pt-4'>
        <div className='space-y-2'>
          {post.authors.map((author, index) => (
            <div key={index} className='grid grid-cols-[auto_1fr] items-center gap-2'>
              <div className='ring-border bg-card aspect-square size-6 overflow-hidden rounded-md border border-transparent shadow-md shadow-black/15 ring-1'>
                <Image
                  src={author.image}
                  alt={author.name}
                  width={46}
                  height={46}
                  className='size-full object-cover'
                />
              </div>
              <span className='text-muted-foreground line-clamp-1 text-sm'>{author.name}</span>
            </div>
          ))}
        </div>
        <div className='flex h-6 items-center'>
          <span
            aria-label={`Read ${post.title}`}
            className='text-primary group-hover:text-foreground flex items-center gap-1 text-sm font-medium transition-colors duration-200'>
            Read
            <ChevronRight
              strokeWidth={2.5}
              aria-hidden='true'
              className='size-3.5 translate-y-px duration-200 group-hover:translate-x-0.5'
            />
          </span>
        </div>
      </div>
    </article>
  )
}
