// apps/homepage/src/app/platform/reporting/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import LogoCloudTwo from '../../_components/logo-cloud'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import { BreadcrumbJsonLd } from '../../_components/seo/breadcrumb-json-ld'
import BuildDashboardsSection from './_components/build-dashboards-section'
import CollaborateSection from './_components/collaborate-section'
import CustomizeSection from './_components/customize-section'
import DataExplorationGrid from './_components/data-exploration-grid'
import DrillDownSection from './_components/drill-down-section'
import FeaturedReports from './_components/featured-reports'
import ReportingFinalCta from './_components/reporting-final-cta'
import ReportingHero from './_components/reporting-hero'

export const metadata: Metadata = {
  title: `Reporting & Dashboards | ${config.shortName}`,
  description: `Build live dashboards over every ticket, contact, and conversation. ${config.shortName} turns your support and CRM data into charts, KPIs, and shareable reports.`,
}

export default function ReportingPage() {
  return (
    <div id='root' className='bg-background relative h-screen overflow-y-auto'>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Platform', href: 'https://auxx.ai/platform' },
          { name: 'Reporting' },
        ]}
      />
      <Header />
      <main>
        <ReportingHero />
        <FeaturedReports />
        <LogoCloudTwo />
        <DrillDownSection />
        <CustomizeSection />
        <BuildDashboardsSection />
        <CollaborateSection />
        <DataExplorationGrid />
        <ReportingFinalCta />
      </main>
      <FooterSection />
    </div>
  )
}
