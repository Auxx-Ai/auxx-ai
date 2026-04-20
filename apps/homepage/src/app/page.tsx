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
import WorkflowAnimationSection from './_components/sections/workflow-animation/workflow-animation-section'
import CrmHero from './platform/crm/_components/crm-hero'
import TicketingFeature from './platform/ticketing/_components/ticketing-feature'
import WorkflowContent from './platform/workflow/_components/workflow-content'

export const metadata: Metadata = {
  title: `AI Customer Support Platform | ${config.shortName}`,
  description: `Scale delightful support with ${config.shortName}'s AI-powered inbox, instant Shopify insights, and automated workflows that convert every customer interaction into revenue.`,
}

function SoftwareApplicationJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Auxx.ai',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, Docker, AWS',
    description:
      'Open-source AI-powered CRM and customer support automation for Shopify businesses. Combines a shared inbox, workflow automation, and AI-generated responses.',
    url: 'https://auxx.ai',
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: '0',
      offerCount: '4',
    },
    featureList: [
      'AI-powered email support',
      'Shopify integration',
      'Workflow automation',
      'Shared inbox',
      'Knowledge base builder',
      'Live chat',
      'CRM',
      'Multi-LLM support',
      'Self-hostable',
    ],
  }

  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

export default function MainPage() {
  return (
    <div id='root' className='relative overflow-y-auto h-screen'>
      <SoftwareApplicationJsonLd />
      <Header />
      <HeroSection />
      <LogoCloudTwo />
      <WorkflowAnimationSection />
      <WorkflowContent />

      <TicketingFeature />
      <CrmHero as='h2' />
      {/* <ProblemSolutionSection /> */}
      <StatsSection />
      <IntegrationSection />
      <TestimonialsSection />
      <FooterSection />
    </div>
  )
}
