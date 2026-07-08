// apps/homepage/src/app/startups/_components/startup-hero.tsx

import { Rocket } from 'lucide-react'
import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { getStartupTierPricing } from '~/lib/startup-offer'

// StartupHero renders the founder-pricing hero with the offer subhead, apply CTA, and offer stats.
export default function StartupHero() {
  return (
    <section className='border-b'>
      <div className='bg-muted py-20'>
        <div className='mx-auto max-w-5xl px-6 pt-5'>
          <div className='grid items-center gap-12 md:grid-cols-2'>
            <div className='max-md:text-center'>
              <span className='text-primary text-sm font-medium'>Startup Program</span>
              <h1 className='mt-4 text-balance text-4xl font-semibold md:text-5xl lg:text-6xl'>
                <span className='text-foreground/50'>Founder pricing for your</span> whole business
                stack
              </h1>
              <p className='text-muted-foreground mb-6 mt-4 max-w-md text-balance text-lg max-md:mx-auto'>
                Run your entire CRM and helpdesk on {config.shortName} from day one. Early-stage
                teams get up to 90% off the platform fee in year one, stepping down as you grow.
              </p>

              <Button asChild>
                <Link href={`${config.urls.signup}?ref=startup`}>Apply now</Link>
              </Button>
              <Button asChild variant='outline' className='ml-3'>
                <Link href='#offer'>See pricing</Link>
              </Button>

              <div className='mt-12 grid max-w-md grid-cols-3 gap-6 max-md:mx-auto'>
                <div className='space-y-2 *:block'>
                  <span className='text-lg font-semibold'>
                    90 <span className='text-muted-foreground text-lg'>%</span>
                  </span>
                  <p className='text-muted-foreground text-balance text-sm'>
                    <strong className='text-foreground font-medium'>Off year one</strong> on the
                    platform fee.
                  </p>
                </div>

                <div className='space-y-2 *:block'>
                  <span className='text-lg font-semibold'>
                    <span className='text-muted-foreground text-lg'>≤ $</span>10
                    <span className='text-muted-foreground text-lg'>M</span>
                  </span>
                  <p className='text-muted-foreground text-balance text-sm'>
                    <strong className='text-foreground font-medium'>Funding raised</strong> for
                    early-stage teams.
                  </p>
                </div>

                <div className='space-y-2 *:block'>
                  <span className='text-lg font-semibold'>
                    <span className='text-muted-foreground text-lg'>&lt;</span> 15
                  </span>
                  <p className='text-muted-foreground text-balance text-sm'>
                    <strong className='text-foreground font-medium'>Small teams</strong>
                  </p>
                </div>
              </div>
            </div>

            <StartupHeroIllustration />
          </div>
        </div>
      </div>
    </section>
  )
}

// StartupHeroIllustration renders a lightweight offer card as the hero accent.
const StartupHeroIllustration = () => {
  return (
    <div className='relative max-md:hidden'>
      <div className='relative mx-auto w-full max-w-sm'>
        <div className='bg-linear-to-r absolute -inset-6 from-blue-400 via-purple-400 to-pink-400 opacity-40 blur-3xl'></div>

        <div className='bg-card ring-foreground/5 relative rounded-2xl p-6 shadow-xl ring-1'>
          <div className='mb-6 flex items-center gap-2'>
            <Rocket className='h-6 w-6 text-primary' />
            <span className='font-semibold'>Startup Program</span>
          </div>

          <div className='space-y-3'>
            {getStartupTierPricing().map((tier) => (
              <div
                key={tier.year}
                className='bg-muted/60 flex items-center justify-between rounded-md px-4 py-3'>
                <span className='text-muted-foreground text-sm font-medium'>{tier.year}</span>
                <span className='text-right'>
                  <span className='text-lg font-semibold text-primary'>{tier.priceLabel}</span>
                  <span className='text-muted-foreground text-sm'>/mo</span>
                  <span className='text-muted-foreground ml-2 text-xs'>{tier.discountLabel}</span>
                </span>
              </div>
            ))}
          </div>

          <p className='text-muted-foreground mt-6 text-xs'>Off the platform fee.</p>
        </div>
      </div>
    </div>
  )
}
