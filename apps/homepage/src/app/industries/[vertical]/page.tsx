// apps/homepage/src/app/industries/[vertical]/page.tsx

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { config } from '~/lib/config'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import { BreadcrumbJsonLd } from '../../_components/seo/breadcrumb-json-ld'
import IndustryCta from '../_components/industry-cta'
import IndustryFaq from '../_components/industry-faq'
import IndustryFeatures from '../_components/industry-features'
import IndustryHero from '../_components/industry-hero'
import IndustryPainPoints from '../_components/industry-pain-points'
import IndustryPricingSection from '../_components/industry-pricing-section'
import IndustryWorkflow from '../_components/industry-workflow'
import { VERTICALS } from '../_data/verticals'

export function generateStaticParams() {
  return Object.keys(VERTICALS).map((vertical) => ({ vertical }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ vertical: string }>
}): Promise<Metadata> {
  const { vertical: slug } = await params
  const vertical = VERTICALS[slug]
  if (!vertical) return { title: 'Not Found' }

  return {
    title: `${vertical.metaTitle} | ${config.shortName}`,
    description: vertical.metaDescription,
    alternates: { canonical: `/industries/${slug}` },
  }
}

export default async function IndustryVerticalPage({
  params,
}: {
  params: Promise<{ vertical: string }>
}) {
  const { vertical: slug } = await params
  const vertical = VERTICALS[slug]
  if (!vertical) notFound()

  return (
    <div id='root' className='bg-background relative h-screen overflow-y-auto'>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Industries', href: 'https://auxx.ai/industries' },
          { name: vertical.name },
        ]}
      />
      <Header />
      <main>
        <IndustryHero vertical={vertical} />
        <IndustryPainPoints vertical={vertical} />
        <IndustryWorkflow vertical={vertical} />
        <IndustryFeatures vertical={vertical} />
        <IndustryPricingSection proseName={vertical.proseName} />
        <IndustryFaq faqs={vertical.faqs} />
        <IndustryCta
          heading={`Run your ${vertical.proseName} business on one board.`}
          currentSlug={vertical.slug}
        />
      </main>
      <FooterSection />
    </div>
  )
}
