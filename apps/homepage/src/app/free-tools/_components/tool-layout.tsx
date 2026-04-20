// apps/homepage/src/app/free-tools/_components/tool-layout.tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import { FaqAccordion, type FaqItem } from '@/app/faq/_components/faq-accordion'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import { BreadcrumbJsonLd } from '../../_components/seo/breadcrumb-json-ld'

type BreadcrumbItem = { name: string; href?: string }

type RelatedTool = { title: string; href: string; description: string }

type ToolLayoutProps = {
  breadcrumb: BreadcrumbItem[]
  title: string
  subhead: string
  sidebar?: ReactNode
  children: ReactNode
  faqs?: FaqItem[]
  relatedTools?: RelatedTool[]
  productCta?: {
    heading: string
    description: string
    href: string
    label: string
  }
  /** 'narrow' (default) renders the body at max-w-3xl. 'fullbleed' widens it to max-w-7xl for interactive studio widgets. */
  variant?: 'narrow' | 'fullbleed'
}

function FaqJsonLd({ items }: { items: FaqItem[] }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

export function ToolLayout({
  breadcrumb,
  title,
  subhead,
  sidebar,
  children,
  faqs,
  relatedTools,
  productCta,
  variant = 'narrow',
}: ToolLayoutProps) {
  const isFullbleed = variant === 'fullbleed'
  const heroSectionClass = isFullbleed
    ? 'mx-auto max-w-7xl px-6 pb-8 pt-24 md:pt-32 lg:pt-36'
    : 'mx-auto max-w-5xl px-6 pb-12 pt-24 md:pt-32 lg:pt-36'
  const bodySectionClass = isFullbleed ? 'mx-auto max-w-7xl px-6' : 'mx-auto max-w-3xl px-6'
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <BreadcrumbJsonLd items={breadcrumb} />
      {faqs && faqs.length > 0 ? <FaqJsonLd items={faqs} /> : null}
      <Header />
      <main className='pb-16'>
        <section className={heroSectionClass}>
          <nav aria-label='Breadcrumb' className='mb-6 text-xs text-muted-foreground'>
            <ol className='flex flex-wrap items-center gap-1.5'>
              {breadcrumb.map((item, idx) => (
                <li key={idx} className='flex items-center gap-1.5'>
                  {item.href ? (
                    <Link href={item.href} className='hover:text-foreground'>
                      {item.name}
                    </Link>
                  ) : (
                    <span aria-current='page' className='text-foreground'>
                      {item.name}
                    </span>
                  )}
                  {idx < breadcrumb.length - 1 ? <span aria-hidden>/</span> : null}
                </li>
              ))}
            </ol>
          </nav>

          <div
            className={
              sidebar && !isFullbleed
                ? 'grid gap-10 md:grid-cols-[1fr_360px]'
                : 'mx-auto max-w-3xl space-y-5'
            }>
            <div className='space-y-5'>
              <h1 className='text-balance text-4xl font-semibold tracking-tight md:text-5xl'>
                {title}
              </h1>
              <p className='text-pretty text-lg text-muted-foreground'>{subhead}</p>
            </div>
            {sidebar && !isFullbleed ? (
              <aside className='md:sticky md:top-24 md:self-start'>
                <div className='rounded-xl border border-border bg-card p-6 shadow-sm'>
                  {sidebar}
                </div>
              </aside>
            ) : null}
          </div>
        </section>

        <section className={bodySectionClass}>
          {isFullbleed ? children : <div className='tool-prose'>{children}</div>}
        </section>

        {faqs && faqs.length > 0 ? (
          <section className='mx-auto max-w-3xl px-6 pt-16'>
            <h2 className='mb-6 text-2xl font-semibold tracking-tight'>
              Frequently asked questions
            </h2>
            <FaqAccordion items={faqs} />
          </section>
        ) : null}

        {relatedTools && relatedTools.length > 0 ? (
          <section className='mx-auto max-w-5xl px-6 pt-16'>
            <h2 className='mb-6 text-2xl font-semibold tracking-tight'>Related free tools</h2>
            <div className='grid gap-4 sm:grid-cols-3'>
              {relatedTools.map((tool) => (
                <Link
                  key={tool.href}
                  href={tool.href}
                  className='rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/30'>
                  <h3 className='mb-1 text-base font-semibold'>{tool.title}</h3>
                  <p className='text-sm text-muted-foreground'>{tool.description}</p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {productCta ? (
          <section className='mx-auto mt-16 max-w-3xl px-6'>
            <div className='rounded-xl border border-border bg-muted/40 p-8 text-center'>
              <h2 className='mb-2 text-xl font-semibold tracking-tight'>{productCta.heading}</h2>
              <p className='mb-5 text-muted-foreground'>{productCta.description}</p>
              <Link
                href={productCta.href}
                className='inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow-md hover:bg-primary/90'>
                {productCta.label}
              </Link>
            </div>
          </section>
        ) : null}
      </main>
      <FooterSection />
    </div>
  )
}
