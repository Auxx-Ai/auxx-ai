// apps/homepage/src/app/platform/ai/kopilot/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../../../_components/main/footer-section'
import Header from '../../../_components/main/header'
import { BreadcrumbJsonLd } from '../../../_components/seo/breadcrumb-json-ld'
import KopilotContextSection from './_components/kopilot-context-section'
import KopilotFinalCta from './_components/kopilot-final-cta'
import KopilotHero from './_components/kopilot-hero'
import KopilotIntelligenceSection from './_components/kopilot-intelligence-section'
import KopilotPersonas from './_components/kopilot-personas'
import KopilotPromptLibrary from './_components/kopilot-prompt-library'
import KopilotTestimonial from './_components/kopilot-testimonial'

export const metadata: Metadata = {
  title: `Kopilot — Workspace AI | ${config.shortName}`,
  description: `${config.shortName} Kopilot searches, updates, and creates across mail, contacts, tickets, and knowledge. Grounded in your data and powered by your own model.`,
}

export default function KopilotPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Platform', href: 'https://auxx.ai/platform' },
          { name: 'AI', href: 'https://auxx.ai/platform/ai/kopilot' },
          { name: 'Kopilot' },
        ]}
      />
      <Header />
      <main>
        <KopilotHero />
        <KopilotPersonas />
        <KopilotContextSection />
        <KopilotIntelligenceSection />
        <KopilotPromptLibrary />
        <KopilotTestimonial />
        <KopilotFinalCta />
      </main>
      <FooterSection />
    </div>
  )
}
