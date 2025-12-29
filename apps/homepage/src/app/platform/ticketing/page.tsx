// apps/homepage/src/app/platform/ticketing/page.tsx
import type { Metadata } from 'next'
import Header from '../../_components/main/header'
import FooterSection from '../../_components/main/footer-section'
import TicketingHero from './_components/ticketing-hero'
import TicketingFeature from './_components/ticketing-feature'
import { config } from '~/lib/config'
import TicketCenterSection from './_components/ticket-center-section'
import Ticket3Columns from './_components/ticket-3-columns'

export const metadata: Metadata = {
  title: `Ticketing System | ${config.shortName}`,
  description: `Route, prioritize, and resolve high-volume tickets with ${config.shortName}'s AI-suggested replies, automations, and real-time Shopify context.`,
}

export default function MessagingPage() {
  return (
    <div id="root" className="relative h-screen overflow-y-auto bg-background">
      <Header />
      <main className="">
        <TicketingHero />
        <TicketCenterSection />
        <TicketingFeature />
        <Ticket3Columns />
      </main>
      <FooterSection />
    </div>
  )
}
