// apps/homepage/src/app/startups/page.tsx
import type { Metadata } from 'next'
import { FinalCtaSection } from '~/app/platform/_components/final-cta-section'
import { config } from '~/lib/config'
import FooterSection from '../_components/main/footer-section'
import Header from '../_components/main/header'
import { BreadcrumbJsonLd } from '../_components/seo/breadcrumb-json-ld'
import HowItWorks from './_components/how-it-works'
import OfferSection from './_components/offer-section'
import StartupHero from './_components/startup-hero'
import StartupsFaq from './_components/startups-faq'

export const metadata: Metadata = {
  title: `Startup Program | ${config.shortName}`,
  description: `Early-stage teams get up to 90% off the ${config.shortName} platform fee — a founder-friendly discount that steps down as you grow. CRM and helpdesk in one, from day one.`,
}

export default function StartupsPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <BreadcrumbJsonLd
        items={[{ name: 'Home', href: 'https://auxx.ai' }, { name: 'Startup Program' }]}
      />
      <Header />
      <main className=''>
        <StartupHero />
        <OfferSection />
        <HowItWorks />
        <StartupsFaq />
        <FinalCtaSection />
      </main>
      <FooterSection />
    </div>
  )
}
