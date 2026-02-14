// apps/homepage/src/app/platform/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../_components/main/footer-section'
import Header from '../_components/main/header'
import { AnalyticsAndReportingSection } from './_components/analytics-and-reporting-section'
import { CoreFeaturesOverviewSection } from './_components/core-features-overview-section'
import { EmailIntelligenceSection } from './_components/email-intelligence-section'
import { FinalCtaSection } from './_components/final-cta-section'
import { FeaturesHeroSection } from './_components/hero-section'
import { HowItWorksSection } from './_components/how-it-works-section'
import { IntegrationsAndApiSection } from './_components/integrations-and-api-section'
import { TestimonialsAndProofSection } from './_components/testimonials-and-proof-section'

export const metadata: Metadata = {
  title: `Platform Overview | ${config.shortName}`,
  description: `Explore ${config.shortName}'s AI platform—shared inbox, automation builder, and analytics that help ecommerce teams deliver five-star support at scale.`,
}

// Renders the Auxx.ai features page by composing all feature-focused sections.
export default function FeaturesPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <Header />
      <main className='bg-muted/30'>
        <FeaturesHeroSection />
        <CoreFeaturesOverviewSection />
        <EmailIntelligenceSection />
        <IntegrationsAndApiSection />
        <AnalyticsAndReportingSection />
        <HowItWorksSection />
        <TestimonialsAndProofSection />
        <FinalCtaSection />
      </main>
      <FooterSection />
    </div>
  )
}
