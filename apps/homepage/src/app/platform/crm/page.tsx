// apps/homepage/src/app/platform/crm/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import CrmCenterSection from './_components/crm-center-section'
import CrmHero from './_components/crm-hero'
import CustomerProfilesSection from './_components/customer-profiles-section'
import HowItWorksSection from './_components/how-it-works-section'

export const metadata: Metadata = {
  title: `AI-Powered CRM | ${config.shortName}`,
  description: `Centralize customer history, automate follow-ups, and surface revenue opportunities with ${config.shortName}'s CRM built for modern support teams.`,
}

export default function CrmPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <Header />
      <main className=''>
        <CrmHero />
        <CustomerProfilesSection />
        <HowItWorksSection />
        <CrmCenterSection />
        {/* <PipelineSection /> */}
      </main>
      <FooterSection />
    </div>
  )
}
