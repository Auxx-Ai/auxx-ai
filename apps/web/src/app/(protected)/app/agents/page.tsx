// apps/web/src/app/(protected)/app/agents/page.tsx
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
import { AgentsProvider } from '~/components/agents'
import { AgentsPageContent } from '~/components/agents/ui/list/agents-page-content'
import { EmptyState } from '~/components/global/empty-state'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

export default function AgentsPage() {
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
      <AgentsPageContent />
    </AgentsProvider>
  )
}
