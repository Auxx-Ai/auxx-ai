// apps/homepage/src/app/blog/_components/post-header.tsx

import Image from 'next/image'
import Link from 'next/link'
import { formatDate } from '~/lib/format-date'
import type { BlogPost } from '~/types/blog'

export function PostHeader({ post }: { post: BlogPost }) {
  return (
    <div className='relative mx-auto max-w-5xl px-6'>
      <header className='mx-auto mb-8 max-w-2xl text-center'>
        <nav aria-label='Breadcrumb'>
          <ol className='text-muted-foreground flex items-center justify-center gap-1.5 text-sm'>
            <li>
              <Link href='/blog' className='hover:text-foreground transition-colors'>
                Blog
              </Link>
            </li>
            <li aria-hidden='true' className='text-muted-foreground/50'>
              /
            </li>
            <li>
              <Link
                href={`/blog/category/${post.category.slug}`}
                className='text-foreground font-medium'>
                {post.category.title}
              </Link>
            </li>
          </ol>
        </nav>

        <h1 className='text-foreground mt-6 text-balance text-3xl font-bold md:text-4xl md:leading-tight lg:text-5xl'>
          {post.title}
        </h1>
      </header>

      {post.image && post.image !== '/blog/default-og.jpg' && (
        <div className='relative overflow-hidden rounded-xl border shadow shadow-black/5'>
          <Image
            src={post.image}
            alt={post.title}
            width={1200}
            height={675}
            className='aspect-video w-full object-cover'
            priority
          />
        </div>
      )}

      <div className='mx-auto max-w-2xl'>
        <div className='flex flex-wrap items-center justify-between gap-4 border-b py-6'>
          <div className='flex flex-wrap items-center gap-4'>
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
                <span className='text-foreground line-clamp-1 text-sm'>{author.name}</span>
              </div>
            ))}
          </div>
          <div className='text-muted-foreground flex items-center gap-3 text-sm'>
            <span>{post.readingTime}</span>
            <span aria-hidden='true'>·</span>
            <time dateTime={new Date(post.date).toISOString()}>{formatDate(post.date)}</time>
          </div>
        </div>

        <p className='text-foreground my-16 text-xl md:text-2xl'>{post.description}</p>
      </div>
    </div>
  )
}
