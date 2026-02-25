// apps/homepage/src/app/page.tsx

import type { Metadata } from 'next'
import { config } from '~/lib/config'
import LogoCloudTwo from './_components/logo-cloud'
import FooterSection from './_components/main/footer-section'
import Header from './_components/main/header'
import HeroSection from './_components/sections/hero-section'
import IntegrationSection from './_components/sections/integration-section'
import StatsSection from './_components/sections/stats-section'
import TestimonialsSection from './_components/sections/testimonials-section'
import CrmHero from './platform/crm/_components/crm-hero'
import TicketingFeature from './platform/ticketing/_components/ticketing-feature'
import WorkflowContent from './platform/workflow/_components/workflow-content'

export const metadata: Metadata = {
  title: `AI Customer Support Platform | ${config.shortName}`,
  description: `Scale delightful support with ${config.shortName}'s AI-powered inbox, instant Shopify insights, and automated workflows that convert every customer interaction into revenue.`,
}

export default function MainPage() {
  return (
    <div id='root' className='relative overflow-y-auto h-screen'>
      <Header />
      <HeroSection />
      <LogoCloudTwo />
      <WorkflowContent />
      <CrmHero />
      <TicketingFeature />
      {/* <ProblemSolutionSection /> */}
      <IntegrationSection />
      <StatsSection />
      <TestimonialsSection />
      <FooterSection />
    </div>
  )
}
