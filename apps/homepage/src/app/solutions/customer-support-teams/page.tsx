// apps/homepage/src/app/solutions/customer-support-teams/page.tsx
import type { Metadata } from 'next'
import Header from '../../_components/main/header'
import FooterSection from '../../_components/main/footer-section'
import ShopifyHero from './_components/support-hero'
import IntegrationSection from './_components/integration-section'
import AutomationSection from './_components/automation-section'
import ResultsSection from './_components/results-section'
import TestimonialsSection from './_components/testimonials'
import { AutomationImpact } from './_components/automation-impact'
import { FinalCtaSection } from '@/app/platform/_components/final-cta-section'
import { config } from '~/lib/config'

export const metadata: Metadata = {
  title: `Customer Support Teams | ${config.shortName}`,
  description: `Empower customer support teams with ${config.shortName}'s AI workflows, unified inbox, and Shopify automations that shrink resolution times and lift CSAT scores.`,
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
