// apps/homepage/src/app/platform/manufacturing/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import { BreadcrumbJsonLd } from '../../_components/seo/breadcrumb-json-ld'
import ManufacturingFeature from './_components/manufacturing-feature'
import ManufacturingHero from './_components/manufacturing-hero'

export const metadata: Metadata = {
  title: `Manufacturing Support | ${config.shortName}`,
  description: `${config.shortName} helps manufacturing teams coordinate parts requests, warranty claims, and dealer communications with AI-powered workflows.`,
}

export default function MessagingPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Platform', href: 'https://auxx.ai/platform' },
          { name: 'Manufacturing Support' },
        ]}
      />
      <Header />
      <main className=''>
        <ManufacturingHero />
        <ManufacturingFeature />
      </main>
      <FooterSection />
    </div>
  )
}
