// apps/homepage/src/app/platform/sequences/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import { BreadcrumbJsonLd } from '../../_components/seo/breadcrumb-json-ld'
import DeliverySection from './_components/delivery-section'
import PersonalizationSection from './_components/personalization-section'
import PlatformCrossLinks from './_components/platform-cross-links'
import SequencesFinalCta from './_components/sequences-final-cta'
import SequencesHero from './_components/sequences-hero'
import TemplatesSection from './_components/templates-section'
import TrackingGrid from './_components/tracking-grid'
import TriggersSection from './_components/triggers-section'

export const metadata: Metadata = {
  alternates: { canonical: '/platform/sequences' },
  title: `Email Sequences & Automated Follow-Ups | ${config.shortName}`,
  description: `Automated reminders, follow-ups, and invoice chasers. ${config.shortName} sends each email on the day it matters — pinned to a visit or due date — and exits the moment a customer replies.`,
}

export default function SequencesPage() {
  return (
    <div id='root' className='bg-background relative h-screen overflow-y-auto'>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Platform', href: 'https://auxx.ai/platform' },
          { name: 'Sequences' },
        ]}
      />
      <Header />
      <main>
        <SequencesHero />
        <TriggersSection />
        <TemplatesSection />
        <PersonalizationSection />
        <DeliverySection />
        <TrackingGrid />
        <PlatformCrossLinks />
        <SequencesFinalCta />
      </main>
      <FooterSection />
    </div>
  )
}
