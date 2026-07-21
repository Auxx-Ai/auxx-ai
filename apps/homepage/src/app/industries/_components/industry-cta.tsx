// apps/homepage/src/app/industries/_components/industry-cta.tsx

import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { VERTICALS } from '../_data/verticals'

export default function IndustryCta({
  heading,
  currentSlug,
}: {
  heading: string
  currentSlug: string
}) {
  const otherVerticals = Object.values(VERTICALS).filter((v) => v.slug !== currentSlug)

  return (
    <section
      data-theme='dark'
      className='border-foreground/10 relative overflow-hidden border-b bg-zinc-950 text-zinc-50'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_rgba(255,255,255,0.08),_transparent_60%)]'
      />
      <div className='relative z-10 mx-auto max-w-4xl px-6 py-24 text-center md:py-32'>
        <h2 className='text-balance text-5xl font-semibold tracking-tight md:text-6xl'>
          {heading}
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

        <div className='text-zinc-400 mt-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm'>
          <span>Also on Auxx:</span>
          {otherVerticals.map((vertical) => (
            <Link
              key={vertical.slug}
              href={`/industries/${vertical.slug}`}
              className='underline decoration-zinc-600 underline-offset-4 hover:text-zinc-50'>
              {vertical.name}
            </Link>
          ))}
          <Link
            href='/platform/dispatch'
            className='underline decoration-zinc-600 underline-offset-4 hover:text-zinc-50'>
            Dispatch platform
          </Link>
        </div>
      </div>
    </section>
  )
}
