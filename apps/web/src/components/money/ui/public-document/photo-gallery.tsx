// apps/web/src/components/money/ui/public-document/photo-gallery.tsx
'use client'

// Shared photo thumbnails + lightbox for public documents (plan 37b §6) — used both for a
// line's small inline thumbnails and the document's header-level "Photos" gallery grid.
// Thumbnails/lightbox images point at the token-scoped `/quote/[token]/photo/[ref]` or
// `/pay/[token]/photo/[ref]` route (the public page has no session, so refs aren't otherwise
// fetchable); `photoBasePath` is that route's base (`/quote/{token}/photo` or
// `/pay/{token}/photo}`), with each photo's `ref` percent-encoded onto it (refs contain a
// `:`, e.g. `asset:abc123`). Decoupled from `@auxx/lib`'s payload types on purpose (only
// `ref`/`caption`) so this client component never statically imports a server-only module.

import { Dialog, DialogContent, DialogTitle } from '@auxx/ui/components/dialog'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'

export interface PublicDocumentPhoto {
  ref: string
  caption?: string
}

interface PhotoGalleryProps {
  photos: PublicDocumentPhoto[]
  /** Base path of the token-scoped photo route, e.g. `/quote/{token}/photo`. */
  photoBasePath: string
  /** `sm` = small inline thumbnails under a line row; `md` = the header gallery grid. */
  size?: 'sm' | 'md'
  className?: string
}

function photoUrl(basePath: string, ref: string): string {
  return `${basePath}/${encodeURIComponent(ref)}`
}

/** Captioned photo thumbnails that open a simple prev/next lightbox dialog on click. Renders
 * nothing when `photos` is empty, so callers can render it unconditionally. */
export function PhotoGallery({ photos, photoBasePath, size = 'md', className }: PhotoGalleryProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  if (photos.length === 0) return null

  const active = openIndex !== null ? photos[openIndex] : undefined
  const step = (delta: number) =>
    setOpenIndex((i) => (i === null ? i : (i + delta + photos.length) % photos.length))

  return (
    <>
      <div className={cn('flex flex-wrap gap-2', size === 'sm' ? 'mt-1.5' : 'mt-3', className)}>
        {photos.map((photo, i) => (
          <button
            key={photo.ref}
            type='button'
            onClick={() => setOpenIndex(i)}
            className={cn(
              'shrink-0 overflow-hidden rounded-md border border-white/10 bg-white/5 transition hover:border-white/30',
              size === 'sm' ? 'size-14' : 'size-24 sm:size-28'
            )}>
            <img
              src={photoUrl(photoBasePath, photo.ref)}
              alt={photo.caption ?? ''}
              loading='lazy'
              className='h-full w-full object-cover'
            />
          </button>
        ))}
      </div>

      <Dialog open={openIndex !== null} onOpenChange={(open) => !open && setOpenIndex(null)}>
        <DialogContent size='xl' innerClassName='items-center'>
          <DialogTitle className='sr-only'>{active?.caption || 'Photo'}</DialogTitle>
          {active ? (
            <div className='flex flex-col items-center gap-3'>
              <div className='relative flex w-full items-center justify-center'>
                {photos.length > 1 ? (
                  <button
                    type='button'
                    aria-label='Previous photo'
                    onClick={() => step(-1)}
                    className='-translate-y-1/2 absolute left-1 top-1/2 flex size-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70'>
                    <ChevronLeft className='size-4' />
                  </button>
                ) : null}
                <img
                  src={photoUrl(photoBasePath, active.ref)}
                  alt={active.caption ?? ''}
                  className='max-h-[70vh] max-w-full rounded-md object-contain'
                />
                {photos.length > 1 ? (
                  <button
                    type='button'
                    aria-label='Next photo'
                    onClick={() => step(1)}
                    className='-translate-y-1/2 absolute right-1 top-1/2 flex size-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70'>
                    <ChevronRight className='size-4' />
                  </button>
                ) : null}
              </div>
              {active.caption ? (
                <p className='text-center text-muted-foreground text-sm'>{active.caption}</p>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
