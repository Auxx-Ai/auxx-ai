// apps/homepage/src/app/platform/integration/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import { BreadcrumbJsonLd } from '../../_components/seo/breadcrumb-json-ld'
import IntegrationAiCenterSection from './_components/integration-ai-center-section'
import IntegrationCenterSection from './_components/integration-center-section'
import IntegrationHero from './_components/integration-hero'
import IntegrationsMarqueeSection from './_components/integrations-marquee-section'
import McpSection from './_components/mcp-section'

export const metadata: Metadata = {
  alternates: { canonical: '/platform/integration' },
  title: `Integrations & API | ${config.shortName}`,
  description: `Connect ${config.shortName} with Shopify, email, Slack, and the rest of your stack using prebuilt apps, MCP servers, and a flexible API to automate customer operations end-to-end.`,
}

export default function IntegrationPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Platform', href: 'https://auxx.ai/platform' },
          { name: 'Integrations & API' },
        ]}
      />
      <Header />
      <main className=''>
        <IntegrationHero />
        <IntegrationCenterSection />
        <IntegrationsMarqueeSection />
        <McpSection />
        <IntegrationAiCenterSection />
        {/* <ApiSection /> */}
        {/* <CustomIntegrationSection /> */}
      </main>
      <FooterSection />
    </div>
  )
}
