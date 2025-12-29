// apps/homepage/src/app/platform/messaging/page.tsx
import type { Metadata } from 'next'
import Header from '../../_components/main/header'
import FooterSection from '../../_components/main/footer-section'
import MessagingHero from './_components/messaging-hero'
import MultiChannelSection from './_components/multi-channel-section'
import NoMissedMessages from './_components/no-missed-messages'
import ProviderIntegrationsSection from './_components/provider-integration'
import MessagingFeatures from './_components/messaging-features'
import Features3Cols from './_components/features-3-cols'
import { config } from '~/lib/config'

export const metadata: Metadata = {
  title: `Omnichannel Messaging | ${config.shortName}`,
  description: `Unify email, chat, SMS, and social messages with ${config.shortName}'s AI-driven routing to ensure no customer inquiry slips through the cracks.`,
}

export default function MessagingPage() {
  return (
    <div id="root" className="relative h-screen overflow-y-auto bg-background">
      <Header />
      <main className="">
        <MessagingHero />
        <MessagingFeatures />
        <Features3Cols />

        <NoMissedMessages />

        <MultiChannelSection />

        <ProviderIntegrationsSection />
      </main>
      <FooterSection />
    </div>
  )
}
