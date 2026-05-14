// apps/web/src/app/(protected)/app/agents/[slug]/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Lock } from 'lucide-react'
import { useParams } from 'next/navigation'
import { AgentsProvider } from '~/components/agents'
import { useAgent } from '~/components/agents/hooks/use-agent'
import { AgentDetailView } from '~/components/agents/ui/detail/agent-detail-view'
import { EmptyState } from '~/components/global/empty-state'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

function AgentDetailLoader({ slug }: { slug: string }) {
  const { detail, isLoading } = useAgent(slug)

  if (isLoading && !detail) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Kopilot' href='/app/kopilot/new' />
            <MainPageBreadcrumbItem title='Agents' href='/app/agents' />
            <MainPageBreadcrumbItem title='Loading…' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='p-6 text-sm text-muted-foreground'>Loading agent…</div>
        </MainPageContent>
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
            <MainPageBreadcrumbItem title='Not found' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            title='Agent not found'
            description='This agent may have been deleted.'
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  return <AgentDetailView agent={detail} />
}

export default function AgentDetailPage() {
  const params = useParams<{ slug: string }>()
  const slug = params?.slug
  const { hasAccess } = useFeatureFlags()
  const { isAdminOrOwner } = useUser()

  if (!hasAccess(FeatureKey.agents) || !isAdminOrOwner) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Kopilot' href='/app/kopilot/new' />
            <MainPageBreadcrumbItem title='Agents' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={Lock}
            title='Agents Not Available'
            description='Agents are admin-only and require the agents feature on your plan.'
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  return (
    <AgentsProvider>
      <AgentDetailLoader slug={slug ?? ''} />
    </AgentsProvider>
  )
}
