// apps/homepage/src/app/blog/_components/post-card.tsx

import { ChevronRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { formatDate } from '~/lib/format-date'
import type { BlogPost } from '~/types/blog'

export function PostCard({ post }: { post: BlogPost }) {
  return (
    <article className='ring-foreground/6.5 hover:bg-card group relative row-span-2 grid grid-rows-subgrid gap-4 rounded-xl p-6 ring-1 duration-200'>
      <div className='space-y-4'>
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
      </div>
      <div className='grid grid-cols-[1fr_auto] items-end gap-2 pt-4'>
        <div className='space-y-2'>
          {post.authors.map((author, index) => (
            <div key={index} className='grid grid-cols-[auto_1fr] items-center gap-2'>
              <div className='ring-border bg-card aspect-square size-6 overflow-hidden rounded-md border border-transparent shadow-md shadow-black/15 ring-1'>
                <Image
                  src={author.image}
                  alt={author.name}
                  width={460}
                  height={460}
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
