// apps/homepage/src/app/industries/page.tsx

import type { Metadata } from 'next'
import Link from 'next/link'
import { config } from '~/lib/config'
import FooterSection from '../_components/main/footer-section'
import Header from '../_components/main/header'
import { BreadcrumbJsonLd } from '../_components/seo/breadcrumb-json-ld'
import { VERTICALS } from './_data/verticals'

export const metadata: Metadata = {
  alternates: { canonical: '/industries' },
  title: `Industries | ${config.shortName}`,
  description:
    'Field service software for HVAC, plumbing, and pest control — scheduling, dispatch, work orders, and invoicing built around your trade.',
}

export default function IndustriesPage() {
  const verticals = Object.values(VERTICALS)

  return (
    <div id='root' className='bg-background relative h-screen overflow-y-auto'>
      <BreadcrumbJsonLd
        items={[{ name: 'Home', href: 'https://auxx.ai' }, { name: 'Industries' }]}
      />
      <Header />
      <main>
        <section className='border-b'>
          <div className='mx-auto max-w-6xl px-6 pb-16 pt-32 text-center md:pt-40 lg:pt-48'>
            <h1 className='text-balance text-5xl font-semibold tracking-tight md:text-7xl'>
              Field service software for your trade.
            </h1>
            <p className='text-muted-foreground relative mx-auto mt-4 max-w-2xl text-balance text-lg'>
              The same dispatch board, work-order records, and invoicing — with the fields and
              workflow of the trade you run.
            </p>
          </div>
        </section>

        <section>
          <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
            <ul className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
              {verticals.map((vertical) => (
                <li key={vertical.slug}>
                  <Link
                    href={`/industries/${vertical.slug}`}
                    className='bg-card hover:ring-foreground/15 ring-foreground/10 flex h-full flex-col items-start gap-2 rounded-xl border p-5 ring-1 transition-shadow hover:shadow-sm'>
                    <div className='text-foreground font-medium'>{vertical.name}</div>
                    <p className='text-muted-foreground text-sm'>{vertical.heroSubline}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <FooterSection />
    </div>
  )
}
