// apps/homepage/src/app/startups/_components/offer-section.tsx

import { GRADIENT_PALETTES } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import { Rocket, Sprout, TrendingUp } from 'lucide-react'
import { getStartupTierPricing, STARTUP_BASE_MONTHLY_PRICE } from '~/lib/startup-offer'
import { TierCard } from './tier-card'

// Icons + supporting copy per tier, in the same order as STARTUP_DISCOUNT_TIERS. Prices and
// discount labels come from the shared startup-offer config.
const TIER_META = [
  {
    icon: Rocket,
    description: 'Get the full platform for a fraction of the price while you find your footing.',
  },
  { icon: Sprout, description: 'Still deeply discounted as your team and support volume grow.' },
  { icon: TrendingUp, description: 'A final step down before you graduate to standard pricing.' },
]

// OfferSection renders the three discount tiers with the shared gradient framing.
export default function OfferSection() {
  const tiers = getStartupTierPricing()

  return (
    <section id='offer' className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='bg-muted/50 @container py-24'>
            <div className='mx-auto w-full max-w-5xl px-6'>
              <div className='mx-auto mb-12 max-w-2xl text-center'>
                <h2 className='text-balance text-3xl font-semibold md:text-4xl'>
                  A discount that grows with you
                </h2>
                <p className='text-muted-foreground mx-auto mt-4 max-w-xl text-balance text-lg'>
                  Three stepped tiers off the platform fee. Land cheap in year one, scale into
                  standard pricing as your team takes off.
                </p>
              </div>

              <div className='relative overflow-hidden rounded-2xl p-6'>
                <RandomGradient colors={[...GRADIENT_PALETTES.ocean]} mode='mesh' animated />
                <div className='@max-4xl:max-w-sm @max-4xl:mx-auto @4xl:grid-cols-3 relative z-10 grid gap-6'>
                  {tiers.map((tier, i) => (
                    <TierCard
                      key={tier.year}
                      icon={TIER_META[i]!.icon}
                      year={tier.year}
                      price={tier.priceLabel}
                      originalPrice={tier.originalPriceLabel}
                      discount={tier.discountLabel}
                      description={TIER_META[i]!.description}
                    />
                  ))}
                </div>
              </div>

              <p className='text-muted-foreground mt-6 text-center text-sm'>
                Discounted Growth plan, billed monthly (normally ${STARTUP_BASE_MONTHLY_PRICE}/mo).
                Standard pricing after year three.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
