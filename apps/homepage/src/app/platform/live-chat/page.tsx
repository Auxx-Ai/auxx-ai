// apps/homepage/src/app/platform/live-chat/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import { BreadcrumbJsonLd } from '../../_components/seo/breadcrumb-json-ld'
import LiveChatCenterSection from './_components/live-chat-center-section'
import LiveChatFeature from './_components/live-chat-feature'
import LiveChatHero from './_components/live-chat-hero'

export const metadata: Metadata = {
  title: `Live Chat Suite | ${config.shortName}`,
  description: `${config.shortName} delivers real-time live chat, AI suggestions, and proactive prompts that convert browsing shoppers into loyal customers.`,
}

export default function MessagingPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Platform', href: 'https://auxx.ai/platform' },
          { name: 'Live Chat Suite' },
        ]}
      />
      <Header />
      <main className=''>
        <LiveChatHero />
        <LiveChatFeature />
        <LiveChatCenterSection />
      </main>
      <FooterSection />
    </div>
  )
}
