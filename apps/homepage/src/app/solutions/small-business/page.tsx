// apps/homepage/src/app/solutions/small-business/page.tsx
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
import SmallBusinessHero from './_components/small-business-hero'
// import { FinalCtaSection } from '~/app/(website)/platform/_components/final-cta-section'
import TestimonialsSection from './_components/testimonials'

export const metadata: Metadata = {
  title: `Small Business Automation | ${config.shortName}`,
  description: `${config.shortName} equips lean teams with AI-powered support, proactive Shopify insights, and automation that keeps response times fast without growing headcount.`,
}

export default function ShopifyStoresPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Solutions' },
          { name: 'Small Business Automation' },
        ]}
      />
      <Header />
      <main className=''>
        <SmallBusinessHero />
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
