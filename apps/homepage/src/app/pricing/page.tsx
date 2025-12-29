// apps/homepage/src/app/pricing/page.tsx
import React from 'react'
import type { Metadata } from 'next'
import Header from '../_components/main/header'
import FooterSection from '../_components/main/footer-section'
import PricingSection from '../_components/sections/pricing-section'
import PlansSection from '../_components/sections/plans-section'
import { config } from '~/lib/config'

export const metadata: Metadata = {
  title: `Pricing | ${config.shortName}`,
  description: `Choose a ${config.shortName} plan that scales with your support volume, from AI-assisted agents to fully automated Shopify customer care with transparent ROI benchmarks.`,
}

const PricingPage = async () => {
  return (
    <div id="root" className="relative overflow-y-auto h-screen">
      <Header />
      <PricingSection />
      {/* <StatsSection /> */}
      <PlansSection />
      <FooterSection />
    </div>
  )
}

export default PricingPage
