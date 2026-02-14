// apps/homepage/src/app/platform/knowledge-base/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import KBCenterSection from './_components/kb-center-section'
import KBHero from './_components/kb-hero'
import PublishArticle from './_components/publish-article'

export const metadata: Metadata = {
  title: `Knowledge Base Builder | ${config.shortName}`,
  description: `Launch self-service libraries with ${config.shortName}, repurpose support answers into SEO-ready articles, and keep help content synced automatically.`,
}

export default function MessagingPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <Header />
      <main className=''>
        <KBHero />
        <PublishArticle />
        <KBCenterSection />
        {/* <MessagingFeatures />
        <Features3Cols /> */}
      </main>
      <FooterSection />
    </div>
  )
}
