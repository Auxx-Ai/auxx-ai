// apps/homepage/src/app/platform/data-model/_components/data-model-wall-hero.tsx

import { GRADIENT_PALETTES } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { DataModelWall } from './data-model-wall'

export default function DataModelWallHero({ as: Heading = 'h1' }: { as?: 'h1' | 'h2' }) {
  return (
    <section className='relative overflow-hidden border-b'>
      <RandomGradient colors={[...GRADIENT_PALETTES.dawn]} mode='mesh' animated blur={10} />
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
