// apps/homepage/src/app/builder/page.tsx

import type { Metadata } from 'next'
import { Yellowtail } from 'next/font/google'
import { cn } from '~/lib/utils'
import FooterSection from '../_components/main/footer-section'
import Header from '../_components/main/header'
import { BreadcrumbJsonLd } from '../_components/seo/breadcrumb-json-ld'
import IndustryFaq from '../industries/_components/industry-faq'
import AppSection from './_components/app-section'
import BuilderCta from './_components/builder-cta'
import BuilderHero from './_components/builder-hero'
import FeatureGrid from './_components/feature-grid'
import ThreeApps from './_components/three-apps'
import Workflow from './_components/workflow'
import { APPS, FAQS } from './_data/content'

/** The hand script for "builder" after the header's wordmark, loaded on this page only. */
const yellowtail = Yellowtail({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-script',
})

const title = 'Auxx Builder: design, PDF takeoff and estimating in one'
const description =
  'Design buildings in 3D, mark up and measure PDF drawings, and turn the quantities into estimates and quotes. Three free apps that work as one, in your browser.'

export const metadata: Metadata = {
  alternates: { canonical: '/builder' },
  title,
  description,
  openGraph: { title, description, url: '/builder' },
}

export default function BuilderPage() {
  return (
    <div
      id='root'
      className={cn('relative h-screen overflow-y-auto bg-background', yellowtail.variable)}>
      <BreadcrumbJsonLd
        items={[{ name: 'Home', href: 'https://auxx.ai' }, { name: 'Auxx Builder' }]}
      />
      <Header product='builder' />
      <main>
        <BuilderHero />
        <ThreeApps />
        {APPS.map((info, index) => (
          <AppSection key={info.app} info={info} muted={index % 2 === 0} />
        ))}
        <Workflow />
        <FeatureGrid />
        <IndustryFaq faqs={FAQS} />
        <BuilderCta />
      </main>
      <FooterSection />
    </div>
  )
}
