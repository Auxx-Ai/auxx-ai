// apps/homepage/src/app/free-tools/page.tsx

import { getHomepageUrl } from '@auxx/config/client'
import type { Metadata } from 'next'
import Link from 'next/link'
import FooterSection from '../_components/main/footer-section'
import Header from '../_components/main/header'
import { BreadcrumbJsonLd } from '../_components/seo/breadcrumb-json-ld'

const CANONICAL = getHomepageUrl('/free-tools')

export const metadata: Metadata = {
  title: 'Free Tools for Small Businesses | Auxx.ai',
  description:
    'Free templates, calculators, and generators for small business owners. Invoice templates, customer support email packs, signature generators, and more.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'Free Tools for Small Businesses',
    description: 'Free templates, calculators, and generators built for small business operators.',
    url: CANONICAL,
    type: 'website',
  },
}

type Tool = {
  title: string
  description: string
  href: string
  status: 'live' | 'coming-soon'
}

const tools: Tool[] = [
  {
    title: 'Invoice Generator',
    description:
      'Free blank invoice template. Fill it in, print it, or email it straight to a customer.',
    href: '/free-tools/invoice-generator',
    status: 'live',
  },
  {
    title: 'Customer Support Email Templates',
    description:
      '15 copy-paste email templates for common support scenarios — refunds, shipping delays, escalations.',
    href: '/free-tools/customer-support-email-templates',
    status: 'live',
  },
  {
    title: 'Refund Request Response Templates',
    description: 'Pre-written replies for refund requests, from approve to decline to partial.',
    href: '/free-tools/refund-request-response-templates',
    status: 'live',
  },
  {
    title: 'Shipping Delay Email Templates',
    description: 'Ready-to-send apology and status-update templates for shipping delays.',
    href: '/free-tools/shipping-delay-email-templates',
    status: 'live',
  },
  {
    title: 'SLA / Response Time Calculator',
    description: 'Work out realistic response time SLAs based on your ticket volume and team size.',
    href: '/free-tools/sla-calculator',
    status: 'live',
  },
  {
    title: 'First Response Time Calculator',
    description: 'Benchmark your first-response time against industry norms.',
    href: '/free-tools/first-response-time-calculator',
    status: 'live',
  },
  {
    title: 'Email Signature Generator',
    description: 'Build a clean, consistent email signature for you and your team.',
    href: '/free-tools/email-signature-generator',
    status: 'live',
  },
  {
    title: 'Customer Support KPIs',
    description:
      'Reference for the metrics that matter — CSAT, FRT, NPS, resolution time, and more.',
    href: '/free-tools/customer-support-kpis',
    status: 'live',
  },
]

function ToolCard({ tool }: { tool: Tool }) {
  const isLive = tool.status === 'live'
  const content = (
    <>
      <div className='mb-2 flex items-center gap-2'>
        <h2 className='text-base font-semibold'>{tool.title}</h2>
        {!isLive ? (
          <span className='rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
            Coming soon
          </span>
        ) : null}
      </div>
      <p className='text-sm text-muted-foreground'>{tool.description}</p>
    </>
  )

  const className =
    'block rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/30'

  if (isLive) {
    return (
      <Link href={tool.href} className={className}>
        {content}
      </Link>
    )
  }
  return (
    <div className={`${className} cursor-not-allowed opacity-70`} aria-disabled='true'>
      {content}
    </div>
  )
}

export default function FreeToolsPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <BreadcrumbJsonLd
        items={[{ name: 'Home', href: 'https://auxx.ai' }, { name: 'Free Tools' }]}
      />
      <Header />
      <main className='pb-16'>
        <section className='mx-auto max-w-5xl px-6 pb-12 pt-24 md:pt-32 lg:pt-36'>
          <div className='max-w-2xl space-y-4'>
            <h1 className='text-balance text-4xl font-semibold tracking-tight md:text-5xl'>
              Free tools for small businesses
            </h1>
            <p className='text-pretty text-lg text-muted-foreground'>
              Templates, calculators, and generators built for small business operators. Free, no
              signup required.
            </p>
          </div>
        </section>

        <section className='mx-auto max-w-5xl px-6'>
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {tools.map((tool) => (
              <ToolCard key={tool.href} tool={tool} />
            ))}
          </div>
        </section>
      </main>
      <FooterSection />
    </div>
  )
}
