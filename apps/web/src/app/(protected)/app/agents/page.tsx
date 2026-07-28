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
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

export default function AgentsPage() {
  const { hasAccess } = useFeatureFlags()
  const { can } = useAccess()

  // `agents.view`, NOT `agents.manage` (plan 25 §4.2.DECIDED): `view` is the
  // *usable* rung, and this is the "can I get in at all" gate. Gating the
  // landing page on the authoring key leaves a member holding view/edit — or
  // one single shared agent — staring at a lock screen. #1346 shipped exactly
  // that bug for workflows. Creating an agent is still `agents.manage`; that
  // gate lives on `CreateAgentButton`.
  if (!hasAccess(FeatureKey.agents) || !can('agents.view')) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Kopilot' href='/app/kopilot/new' />
            <MainPageBreadcrumbItem title='Agents' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={Lock}
            title='Agents Not Available'
            description='Agents require the agents feature on your plan and permission to use agents.'
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
