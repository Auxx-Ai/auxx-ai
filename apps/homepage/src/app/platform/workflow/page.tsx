// apps/homepage/src/app/platform/workflow/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import Features3Cols from './_components/features-3-cols'
import NodesSection from './_components/nodes-section'
import Reporting2Cols from './_components/reporting-2-cols'
import WorkflowContent from './_components/workflow-content'
import WorkflowHero from './_components/workflow-hero'

export const metadata: Metadata = {
  title: `Workflow Automation | ${config.shortName}`,
  description: `Build drag-and-drop automations with ${config.shortName} to triage tickets, trigger order actions, and scale customer support without sacrificing quality.`,
}

export default function WorkflowPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <Header />
      <main className=''>
        <WorkflowHero />
        <WorkflowContent />
        <Features3Cols />
        <Reporting2Cols />
        <NodesSection />
      </main>
      <FooterSection />
    </div>
  )
}
