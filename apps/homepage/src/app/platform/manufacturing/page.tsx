// apps/homepage/src/app/platform/manufacturing/page.tsx
import type { Metadata } from 'next'
import Header from '../../_components/main/header'
import FooterSection from '../../_components/main/footer-section'
import ManufacturingHero from './_components/manufacturing-hero'
import ManufacturingFeature from './_components/manufacturing-feature'
import { config } from '~/lib/config'

export const metadata: Metadata = {
  title: `Manufacturing Support | ${config.shortName}`,
  description: `${config.shortName} helps manufacturing teams coordinate parts requests, warranty claims, and dealer communications with AI-powered workflows.`,
}

export default function MessagingPage() {
  return (
    <div id="root" className="relative h-screen overflow-y-auto bg-background">
      <Header />
      <main className="">
        <ManufacturingHero />
        <ManufacturingFeature />
      </main>
      <FooterSection />
    </div>
  )
}
