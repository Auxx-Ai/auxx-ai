// apps/homepage/src/app/company/page.tsx
import type { Metadata } from 'next'
import FooterSection from '../_components/main/footer-section'
import Header from '../_components/main/header'
import { ImageIllustration } from '../_components/sections/image-illustration'
import HowCanWeHelp from './_components/how-can-we-help'
import { config } from '~/lib/config'

export const metadata: Metadata = {
  title: `About ${config.shortName} | AI Customer Support Innovators`,
  description: `${config.shortName} helps CX leaders automate support with AI-driven workflows, deep Shopify alignment, and a human-approved customer experience team focused on faster resolutions.`,
}

// Renders the Auxx.ai company page by composing storytelling-focused sections.
export default function FeaturesPage() {
  return (
    <div id="root" className="relative h-screen overflow-y-auto bg-background">
      <Header />
      <main className="">
        <ImageIllustration />
        <HowCanWeHelp />
      </main>
      <FooterSection />
    </div>
  )
}
