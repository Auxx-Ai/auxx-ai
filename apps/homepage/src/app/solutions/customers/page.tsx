// apps/homepage/src/app/solutions/customers/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import TestimonialsSection from '../../_components/sections/testimonials-section'

export const metadata: Metadata = {
  title: `Customer Stories | ${config.shortName}`,
  description: `See how growth-minded brands use ${config.shortName} to automate customer conversations, drive retention, and deliver premium experiences across every channel.`,
}

export default function EnterprisePage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <Header />
      <main className=''>
        <TestimonialsSection />
      </main>
      <FooterSection />
    </div>
  )
}
