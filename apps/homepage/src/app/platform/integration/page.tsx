// apps/homepage/src/app/platform/integration/page.tsx
import type { Metadata } from 'next'
import Header from '../../_components/main/header'
import FooterSection from '../../_components/main/footer-section'
import IntegrationHero from './_components/integration-hero'
import MarketplaceSection from './_components/marketplace-section'
import ApiSection from './_components/api-section'
import CustomIntegrationSection from './_components/custom-integration-section'
import { config } from '~/lib/config'
import IntegrationCenterSection from './_components/integration-center-section'
import IntegrationAiCenterSection from './_components/integration-ai-center-section'

export const metadata: Metadata = {
  title: `Integrations & API | ${config.shortName}`,
  description: `Connect ${config.shortName} with Shopify, email, and internal tools using prebuilt connectors and a flexible API to automate customer operations end-to-end.`,
}

export default function IntegrationPage() {
  return (
    <div id="root" className="relative h-screen overflow-y-auto bg-background">
      <Header />
      <main className="">
        <IntegrationHero />
        <IntegrationCenterSection />
        <MarketplaceSection />
        <IntegrationAiCenterSection />
        {/* <ApiSection /> */}
        {/* <CustomIntegrationSection /> */}
      </main>
      <FooterSection />
    </div>
  )
}
