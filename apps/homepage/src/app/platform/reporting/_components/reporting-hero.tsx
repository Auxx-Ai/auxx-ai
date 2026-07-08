// apps/homepage/src/app/platform/reporting/_components/reporting-hero.tsx

import { ChartLine } from 'lucide-react'
import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { ReportingHeroTiles } from './reporting-hero-tiles'

export default function ReportingHero() {
  return (
    <section className='bg-muted/50 relative overflow-hidden border-b'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-[radial-gradient(ellipse_at_top,_var(--color-primary)/10,_transparent_60%)]'
      />
      <div className='mx-auto max-w-6xl px-6 pb-20 pt-32 text-center md:pt-40 lg:pt-48'>
        <div className='border-foreground/10 bg-muted/40 mx-auto inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs'>
          <ChartLine className='size-3.5 text-sky-500' />
          <span className='text-muted-foreground'>Reporting & Dashboards</span>
        </div>

        <h1 className='mt-6 text-balance text-5xl font-semibold tracking-tight md:text-7xl'>
          Reports for the teams who answer.
        </h1>
        <p className='text-muted-foreground relative mx-auto mt-4 max-w-2xl text-balance text-lg'>
          Live dashboards over every ticket, contact, and conversation — no BI tool required.
        </p>

        <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
          <Button asChild size='sm'>
            <Link href={config.urls.signup}>Start Free Trial</Link>
          </Button>
          <Button asChild size='sm' variant='outline'>
            <Link href={config.urls.demo}>Try Demo</Link>
          </Button>
        </div>

        <ReportingHeroTiles />
      </div>
    </section>
  )
}
