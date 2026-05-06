// apps/homepage/src/app/platform/data-model/_components/data-model-wall-hero.tsx

import { GRADIENT_PALETTES } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import Link from 'next/link'
import { SectionBottomFade } from '~/app/_components/main/section-bottom-fade'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { cn } from '~/lib/utils'
import { DataModelWall } from './data-model-wall'

interface DataModelWallHeroProps {
  as?: 'h1' | 'h2'
  /**
   * When set, renders a `SectionBottomFade` that blends the gradient
   * into the next section's color. Use `'var(--color-background)'` when
   * the section directly below has `bg-background`.
   */
  bottomFadeColor?: string
}

export default function DataModelWallHero({
  as: Heading = 'h1',
  bottomFadeColor,
}: DataModelWallHeroProps) {
  return (
    <section className={cn('relative overflow-hidden', !bottomFadeColor && 'border-b')}>
      <RandomGradient colors={[...GRADIENT_PALETTES.dawn]} mode='mesh' animated blur={10} />
      {bottomFadeColor && <SectionBottomFade toColor={bottomFadeColor} />}
      <section className='bg-background/40 relative z-10'>
        <div className='relative px-6 pb-20 pt-24 md:pt-36 lg:pt-40'>
          <div className='mx-auto max-w-3xl text-center'>
            <Heading className='text-balance text-4xl font-semibold md:text-5xl'>
              Your data model. Two ways to feed AI.
            </Heading>
            <p className='text-muted-foreground mb-6 mt-4 text-balance text-lg'>
              Author rich knowledge base articles or upload existing docs. Auxx turns both into
              grounded answers for your customers and your team.
            </p>
            <div className='flex items-center justify-center gap-3'>
              <Button asChild size='sm'>
                <Link href={config.urls.signup}>Start Building</Link>
              </Button>
              <Button asChild size='sm' variant='outline'>
                <Link href={config.urls.demo}>Request demo</Link>
              </Button>
            </div>
          </div>
          <div className='mt-16'>
            <DataModelWall />
          </div>
        </div>
      </section>
    </section>
  )
}
