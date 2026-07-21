// apps/homepage/src/app/platform/dispatch/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import LogoCloudTwo from '../../_components/logo-cloud'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import { BreadcrumbJsonLd } from '../../_components/seo/breadcrumb-json-ld'
import BoardSection from './_components/board-section'
import DispatchFaqSection from './_components/dispatch-faq-section'
import DispatchFinalCta from './_components/dispatch-final-cta'
import DispatchHero from './_components/dispatch-hero'
import IndustriesGrid from './_components/industries-grid'
import IntakeSection from './_components/intake-section'
import JobRecordsSection from './_components/job-records-section'
import MoneySection from './_components/money-section'
import PipelineSection from './_components/pipeline-section'
import PlatformSection from './_components/platform-section'
import RoadmapStrip from './_components/roadmap-strip'
import RoutePlannerSection from './_components/route-planner-section'
import WorkerSection from './_components/worker-section'

export const metadata: Metadata = {
  alternates: { canonical: '/platform/dispatch' },
  title: `Field Service Dispatch Software | ${config.shortName}`,
  description: `Schedule and dispatch field workers, manage work orders, quote and invoice jobs — with an AI-powered CRM and helpdesk built in. ${config.shortName} runs your whole field service pipeline.`,
}

export default function DispatchPage() {
  return (
    <div id='root' className='bg-background relative h-screen overflow-y-auto'>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Platform', href: 'https://auxx.ai/platform' },
          { name: 'Dispatch' },
        ]}
      />
      <Header />
      <main>
        <DispatchHero />
        <PipelineSection />
        <LogoCloudTwo />
        <IntakeSection />
        <BoardSection />
        <JobRecordsSection />
        <WorkerSection />
        <RoutePlannerSection />
        <MoneySection />
        <PlatformSection />
        <RoadmapStrip />
        <IndustriesGrid />
        <DispatchFaqSection />
        <DispatchFinalCta />
      </main>
      <FooterSection />
    </div>
  )
}
