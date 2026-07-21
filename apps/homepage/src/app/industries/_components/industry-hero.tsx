// apps/homepage/src/app/industries/_components/industry-hero.tsx

import { Wrench } from 'lucide-react'
import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { MockMiniBoard } from '../../platform/dispatch/_mocks/board-mock'
import type { IndustryVertical } from '../_data/verticals'

export default function IndustryHero({ vertical }: { vertical: IndustryVertical }) {
  return (
    <section className='bg-muted/50 relative overflow-hidden border-b'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-[radial-gradient(ellipse_at_top,_var(--color-primary)/10,_transparent_60%)]'
      />
      <div className='mx-auto max-w-6xl px-6 pb-20 pt-32 text-center md:pt-40 lg:pt-48'>
        <div className='border-foreground/10 bg-muted/40 mx-auto inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs'>
          <Wrench className='size-3.5 text-orange-500' />
          <span className='text-muted-foreground'>{vertical.badge}</span>
        </div>

        <h1 className='mt-6 text-balance text-5xl font-semibold tracking-tight md:text-7xl'>
          {vertical.heroHeadline}
        </h1>
        <p className='text-muted-foreground relative mx-auto mt-4 max-w-2xl text-balance text-lg'>
          {vertical.heroSubline}
        </p>

        <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
          <Button asChild size='sm'>
            <Link href={config.urls.signup}>Start Free Trial</Link>
          </Button>
          <Button asChild size='sm' variant='outline'>
            <Link href={config.urls.demo}>Try Demo</Link>
          </Button>
        </div>

        <MockMiniBoard rows={vertical.boardRows} className='mx-auto mt-12 max-w-4xl' />
      </div>
    </section>
  )
}
