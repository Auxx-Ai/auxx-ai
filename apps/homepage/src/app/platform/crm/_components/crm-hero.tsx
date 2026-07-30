// apps/homepage/src/app/platform/crm/_components/crm-hero.tsx

import { Database } from 'lucide-react'
import Link from 'next/link'
import { SectionBottomFade } from '~/app/_components/main/section-bottom-fade'
import { SectionTopFade } from '~/app/_components/main/section-top-fade'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { cn } from '~/lib/utils'
import { CrmBrowserDemo, EntityCanvas, EntityCardsGrid } from '../_mocks'

/**
 * `HeroSection`'s `bg-muted/30`, resolved to a flat colour so the fade has a
 * real RGB triple to interpolate from. Same expression `CrmCenterSection` uses
 * for the same neighbour.
 */
const HOME_HERO_COLOR = 'color-mix(in oklab, var(--color-muted) 30%, var(--color-background))'

interface CrmHeroProps {
  as?: 'h1' | 'h2'
  /**
   * When set, renders a `SectionBottomFade` that blends the gradient
   * into the next section's color. Drops the hard `border-b` when active.
   */
  bottomFadeColor?: string
  /**
   * Colour of the section above. Only used when this renders as an `h2` (i.e.
   * stacked under another page's hero) — as an `h1` it *is* the top of the
   * page and has nothing to blend from. Defaults to the main homepage hero's
   * colour, which is the only place it currently sits second.
   */
  topFadeColor?: string
}

/**
 * Attio-data-model-style hero: centered headline flanked by entity cards
 * connected with dotted SVG relationship lines, flowing down into a mock
 * app browser showing a contacts records view.
 */
export default function CrmHero({
  as: Heading = 'h1',
  bottomFadeColor,
  topFadeColor = HOME_HERO_COLOR,
}: CrmHeroProps) {
  const showTopFade = Heading === 'h2'
  return (
    <section className={cn('relative overflow-hidden', !bottomFadeColor && 'border-b')}>
      {/* Dot-grid background, faded toward the edges. */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-foreground)_1px,transparent_1px)] [background-size:24px_24px] opacity-[0.06] [mask-image:radial-gradient(ellipse_at_top,black_45%,transparent_90%)]'
      />
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_at_top,_var(--color-primary)/8,_transparent_60%)]'
      />
      {showTopFade && <SectionTopFade fromColor={topFadeColor} />}
      {bottomFadeColor && <SectionBottomFade toColor={bottomFadeColor} />}

      <div className='relative mx-auto max-w-6xl px-6 pb-20 pt-24 md:pt-32 lg:pt-36'>
        <EntityCanvas className='hidden lg:block' />

        <div className='relative z-10 mx-auto max-w-2xl text-center'>
          <div className='mx-auto inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-muted/40 px-3 py-1 text-xs'>
            <Database className='size-3.5 text-blue-500' />
            <span className='text-muted-foreground'>CRM · One data model</span>
          </div>

          <Heading className='mt-6 text-balance text-4xl font-semibold tracking-tight md:text-5xl lg:text-6xl'>
            Every customer.
            <br />
            One record.
          </Heading>
          <p className='mx-auto mt-4 max-w-xl text-balance text-lg text-muted-foreground'>
            Contacts, tickets, orders, and conversations — connected in one CRM built for support.
          </p>

          <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
            <Button asChild size='sm'>
              <Link href={config.urls.signup}>Start for free</Link>
            </Button>
            <Button asChild size='sm' variant='outline'>
              <Link href={config.urls.demo}>Talk to sales</Link>
            </Button>
          </div>
        </div>

        <EntityCardsGrid className='mt-14 lg:hidden' />

        <CrmBrowserDemo className='relative z-10 mt-14 lg:mt-[290px]' />
      </div>
    </section>
  )
}
