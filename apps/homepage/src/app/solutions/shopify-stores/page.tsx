// apps/homepage/src/app/solutions/shopify-stores/page.tsx
import type { Metadata } from 'next'
import Header from '../../_components/main/header'
import FooterSection from '../../_components/main/footer-section'
import ShopifyHero from './_components/shopify-hero'
import IntegrationSection from './_components/integration-section'
import AutomationSection from './_components/automation-section'
import ResultsSection from './_components/results-section'
import TestimonialsSection from './_components/testimonials'
import { AutomationImpact } from './_components/automation-impact'
import { FinalCtaSection } from '@/app/platform/_components/final-cta-section'
import { config } from '~/lib/config'

export const metadata: Metadata = {
  title: `Shopify Store Support | ${config.shortName}`,
  description: `${config.shortName} connects directly to Shopify to resolve tickets, automate refunds, and deliver upsell-ready responses that turn support into a profit center.`,
}

export default function ShopifyStoresPage() {
  return (
    <div id="root" className="relative h-screen overflow-y-auto bg-background">
      <Header />
      <main className="">
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
