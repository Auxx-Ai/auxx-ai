// apps/homepage/src/app/blog/_components/post-card.tsx

import { GRADIENT_PALETTES, type GradientPaletteName } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import { ChevronRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { getPostImage } from '~/lib/blog-image'
import { formatDate } from '~/lib/format-date'
import type { BlogPost } from '~/types/blog'

const FALLBACK_PALETTES: GradientPaletteName[] = [
  'aurora',
  'ocean',
  'dusk',
  'sunset',
  'meadow',
  'twilight',
]

function pickPalette(slug: string): GradientPaletteName {
  let h = 2166136261
  for (let i = 0; i < slug.length; i++) {
    h = Math.imul(h ^ slug.charCodeAt(i), 16777619)
  }
  return FALLBACK_PALETTES[Math.abs(h | 0) % FALLBACK_PALETTES.length]!
}

export function PostCard({ post, priority }: { post: BlogPost; priority?: boolean }) {
  const image = getPostImage(post)

  return (
    <article className='bg-card hover:bg-card/75 group relative flex flex-col space-y-4 rounded-md p-6 duration-200'>
      <div className='before:border-foreground/15 before:inset-ring-1 before:inset-ring-background/10 relative aspect-[3/2] overflow-hidden rounded-[10px] shadow-md shadow-black/10 before:absolute before:inset-0 before:rounded-[10px] before:border'>
        {image ? (
          <Image
            src={image}
            alt={post.title}
            fill
            className='object-cover'
            sizes='(min-width: 1024px) 25vw, (min-width: 640px) 45vw, 90vw'
            priority={priority}
          />
        ) : (
          <RandomGradient
            colors={[...GRADIENT_PALETTES[pickPalette(post.slug)]]}
            mode='mesh'
            animationDuration={4}
          />
        )}
        {/* Scrim so the title stays legible over artwork or a pale palette. Both
            treatments get it, and the title is pinned white, so the tile reads
            the same in either theme. */}
        <div
          aria-hidden
          className='absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-black/80 via-black/30 to-transparent'
        />
        <div className='relative z-10 flex h-full items-end p-4'>
          <h2 className='text-balance text-lg font-semibold text-white'>{post.title}</h2>
        </div>
      </div>

      <time
        className='text-muted-foreground block text-sm'
        dateTime={new Date(post.date).toISOString()}>
        {formatDate(post.date)}
      </time>

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
          {/* Decorative — the stretched link below is the real target, so this
              must not announce itself as a second control. */}
          <span
            aria-hidden='true'
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

      {/* One stretched target so the whole card — artwork, title, and the "Read"
          affordance the group-hover styling already telegraphs — navigates. */}
      <Link
        href={`/blog/${post.slug}`}
        className='focus-visible:ring-ring absolute inset-0 z-10 rounded-md focus-visible:outline-none focus-visible:ring-2'>
        <span className='sr-only'>Read {post.title}</span>
      </Link>
    </article>
  )
}
