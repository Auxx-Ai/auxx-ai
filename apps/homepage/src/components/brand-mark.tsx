// apps/homepage/src/components/brand-mark.tsx

import Image from 'next/image'
import { cn } from '~/lib/utils'

interface BrandMarkProps {
  /** Path under `/public`, e.g. `/images/brands/linear.svg`. */
  src: string
  /** Brand name — used for the alt text. */
  name: string
  className?: string
  imageClassName?: string
}

/**
 * A brand logo on a fixed white tile.
 *
 * Several of the marks we ship (GitHub, Notion, UPS…) are near-black on transparent, so they
 * disappear on a dark surface. Pinning the tile to white in both themes keeps every mark legible
 * without maintaining a `-dark` variant per brand.
 */
export const BrandMark = ({ src, name, className, imageClassName }: BrandMarkProps) => (
  <span
    className={cn(
      'flex size-8 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-black/5',
      className
    )}>
    <Image
      src={src}
      alt={`${name} logo`}
      width={32}
      height={32}
      className={cn('size-5 object-contain', imageClassName)}
    />
  </span>
)

export default BrandMark
