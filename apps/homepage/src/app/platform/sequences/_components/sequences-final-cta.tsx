// apps/homepage/src/app/platform/sequences/_components/sequences-final-cta.tsx

import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'

export default function SequencesFinalCta() {
  return (
    <section
      data-theme='dark'
      className='relative overflow-hidden border-b border-foreground/10 bg-zinc-950 text-zinc-50'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_rgba(255,255,255,0.08),_transparent_60%)]'
      />
      <div className='relative z-10 mx-auto max-w-4xl px-6 py-24 text-center md:py-32'>
        <h2 className='text-balance text-5xl font-semibold tracking-tight md:text-6xl'>
          Set it once. Stop chasing.
        </h2>
        <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
          <Button asChild size='sm'>
            <Link href={config.urls.signup}>Start Free Trial</Link>
          </Button>
          <Button
            asChild
            size='sm'
            variant='outline'
            className='border-zinc-700 bg-transparent text-zinc-50 hover:bg-zinc-900'>
            <Link href={config.urls.demo}>Try Demo</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
