// apps/homepage/src/app/platform/sequences/_components/sequences-hero.tsx

import { Clock } from 'lucide-react'
import Link from 'next/link'
import { SectionBottomFade } from '~/app/_components/main/section-bottom-fade'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { cn } from '~/lib/utils'
import { SequencesBrowserDemo } from '../_mocks'

interface SequencesHeroProps {
  as?: 'h1' | 'h2'
  /**
   * When set, renders a `SectionBottomFade` that blends the gradient into the
   * next section's color. Drops the hard `border-b` when active.
   */
  bottomFadeColor?: string
}

/**
 * Timing-led hero: centered copy over a dot grid, flowing into a mock of the
 * real sequence detail surface (stats strip + Recipients tab).
 */
export default function SequencesHero({ as: Heading = 'h1', bottomFadeColor }: SequencesHeroProps) {
  return (
    <section className={cn('relative overflow-hidden', !bottomFadeColor && 'border-b')}>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-foreground)_1px,transparent_1px)] [background-size:24px_24px] opacity-[0.06] [mask-image:radial-gradient(ellipse_at_top,black_45%,transparent_90%)]'
      />
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_at_top,_var(--color-primary)/8,_transparent_60%)]'
      />
      {bottomFadeColor && <SectionBottomFade toColor={bottomFadeColor} />}

      <div className='relative mx-auto max-w-6xl px-6 pb-20 pt-24 md:pt-32 lg:pt-36'>
        <div className='relative z-10 mx-auto max-w-2xl text-center'>
          <div className='mx-auto inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-muted/40 px-3 py-1 text-xs'>
            <Clock className='size-3.5 text-blue-500' />
            <span className='text-muted-foreground'>Automation · Sequences</span>
          </div>

          <Heading className='mt-6 text-balance text-4xl font-semibold tracking-tight md:text-5xl lg:text-6xl'>
            The right email.
            <br />
            The right day.
          </Heading>
          <p className='mx-auto mt-4 max-w-xl text-balance text-lg text-muted-foreground'>
            Reminders, follow-ups, and invoice chasers that fire off real events — and stop the
            moment someone replies.
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

        <SequencesBrowserDemo className='relative z-10 mt-14' />
      </div>
    </section>
  )
}
