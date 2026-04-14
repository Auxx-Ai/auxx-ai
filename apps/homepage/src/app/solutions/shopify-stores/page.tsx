// apps/homepage/src/app/solutions/shopify-stores/page.tsx
import type { Metadata } from 'next'
import { FinalCtaSection } from '@/app/platform/_components/final-cta-section'
import { config } from '~/lib/config'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import { BreadcrumbJsonLd } from '../../_components/seo/breadcrumb-json-ld'
import { AutomationImpact } from './_components/automation-impact'
import AutomationSection from './_components/automation-section'
import IntegrationSection from './_components/integration-section'
import ResultsSection from './_components/results-section'
import ShopifyHero from './_components/shopify-hero'
import TestimonialsSection from './_components/testimonials'

export const metadata: Metadata = {
  title: `Shopify Store Support | ${config.shortName}`,
  description: `${config.shortName} connects directly to Shopify to resolve tickets, automate refunds, and deliver upsell-ready responses that turn support into a profit center.`,
}

export default function ShopifyStoresPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Solutions' },
          { name: 'Shopify Store Support' },
        ]}
      />
      <Header />
      <main className=''>
        <ShopifyHero />
        <IntegrationSection />
        <AutomationSection />
        <AutomationImpact />

        <ResultsSection />
        <TestimonialsSection />
        <FinalCtaSection />
      </main>
      <FooterSection />
    </div>
  )
}
