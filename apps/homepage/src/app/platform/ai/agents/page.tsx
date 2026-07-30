// apps/homepage/src/app/platform/ai/agents/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../../../_components/main/footer-section'
import Header from '../../../_components/main/header'
import { BreadcrumbJsonLd } from '../../../_components/seo/breadcrumb-json-ld'
import AgentRosterSection from './_components/agent-roster-section'
import AgentRunSection from './_components/agent-run-section'
import AgentsCrossLinks from './_components/agents-cross-links'
import AgentsFinalCta from './_components/agents-final-cta'
import AgentsHero from './_components/agents-hero'
import EvalDetailGrid from './_components/eval-detail-grid'
import EvalsSection from './_components/evals-section'

export const metadata: Metadata = {
  alternates: { canonical: '/platform/ai/agents' },
  title: `AI Agents with Procedures & Evals | ${config.shortName}`,
  description: `${config.shortName} agents follow a playbook you write in plain language, call only the tools you scope to them, and are proven by simulated evals before they reach a customer.`,
}

export default function AgentsPage() {
  return (
    <div id='root' className='bg-background relative h-screen overflow-y-auto'>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Platform', href: 'https://auxx.ai/platform' },
          { name: 'AI', href: 'https://auxx.ai/platform/ai/kopilot' },
          { name: 'Agents' },
        ]}
      />
      <Header />
      <main>
        <AgentsHero />
        <AgentRosterSection />
        <AgentRunSection />
        <EvalsSection />
        <EvalDetailGrid />
        <AgentsCrossLinks />
        <AgentsFinalCta />
      </main>
      <FooterSection />
    </div>
  )
}
