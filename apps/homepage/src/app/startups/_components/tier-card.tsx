// apps/homepage/src/app/startups/_components/tier-card.tsx

import type { LucideIcon } from 'lucide-react'

export interface TierCardProps {
  /** Icon rendered at the top of the card. */
  icon: LucideIcon
  /** Program year label, e.g. "Year 1". */
  year: string
  /** Discounted monthly price, e.g. "$5". */
  price: string
  /** The undiscounted base monthly price, e.g. "$50". */
  originalPrice: string
  /** Discount headline, e.g. "90% off". */
  discount: string
  /** Supporting copy describing the tier. */
  description: string
}

// TierCard renders a single discount tier in the offer grid.
export const TierCard = ({
  icon: Icon,
  year,
  price,
  originalPrice,
  discount,
  description,
}: TierCardProps) => (
  <div className='bg-card/80 ring-foreground/5 grid grid-rows-[auto_1fr] gap-4 overflow-hidden rounded-2xl border border-transparent p-6 shadow-md shadow-black/5 ring-1'>
    <div>
      <Icon className='fill-foreground/10 mb-5 size-4' />
      <h3 className='text-muted-foreground text-sm font-medium'>{year}</h3>
      <p className='text-foreground mt-1 text-3xl font-semibold'>
        {price}
        <span className='text-muted-foreground text-base font-normal'>/mo</span>
      </p>
      <p className='mt-1 text-sm'>
        <span className='text-muted-foreground line-through'>{originalPrice}</span>{' '}
        <span className='text-primary font-medium'>{discount}</span>
      </p>
    </div>
    <p className='text-muted-foreground text-balance text-sm'>{description}</p>
  </div>
)
