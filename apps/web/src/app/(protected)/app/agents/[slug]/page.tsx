// apps/web/src/app/(protected)/app/agents/[slug]/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { useParams } from 'next/navigation'
import { AgentsProvider } from '~/components/agents'
import { useAgent } from '~/components/agents/hooks/use-agent'
import { useAgentRealtime } from '~/components/agents/hooks/use-agent-realtime'
import { AgentDetailView } from '~/components/agents/ui/detail/agent-detail-view'
import {
  MainPageLoading,
  MainPageNoPermission,
  MainPageNotFound,
} from '~/components/global/main-page-states'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

function AgentDetailLoader({ slug }: { slug: string }) {
  const { detail, isLoading } = useAgent(slug)
  useAgentRealtime()

  if (isLoading && !detail) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Kopilot' href='/app/kopilot/new' />
            <MainPageBreadcrumbItem title='Agents' href='/app/agents' />
            <MainPageBreadcrumbItem title='Loading…' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageLoading />
      </MainPage>
    )
  }

  if (!detail) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Kopilot' href='/app/kopilot/new' />
            <MainPageBreadcrumbItem title='Agents' href='/app/agents' />
            <MainPageBreadcrumbItem title='Not found' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageNotFound title='Agent not found' description='This agent may have been deleted.' />
      </MainPage>
    )
  }

  return <AgentDetailView agent={detail} />
}

export default function AgentDetailPage() {
  const params = useParams<{ slug: string }>()
  const slug = params?.slug
  const { hasAccess } = useFeatureFlags()
  const { can } = useAccess()

  if (!hasAccess(FeatureKey.agents) || !can('agents.manage')) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Kopilot' href='/app/kopilot/new' />
            <MainPageBreadcrumbItem title='Agents' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageNoPermission
          title='Agents Not Available'
          description='Agents require the agents feature on your plan and permission to manage agents.'
        />
      </MainPage>
    )
  }

  return (
    <AgentsProvider>
      <AgentDetailLoader slug={slug ?? ''} />
    </AgentsProvider>
  )
}
