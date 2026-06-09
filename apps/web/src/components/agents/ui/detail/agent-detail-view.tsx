// apps/web/src/components/agents/ui/detail/agent-detail-view.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { useState } from 'react'
import { useMedia } from '~/hooks/use-media'
import { useDockStore } from '~/stores/dock-store'
import type { AgentDetail } from '../../store/agent-store'
import { AutosaveIndicator, type AutosaveState } from '../shared/autosave-indicator'
import { AgentActionsMenu } from './agent-actions-menu'
import { AgentBreadcrumbSwitcher } from './agent-breadcrumb-switcher'
import { AgentDetailTabs } from './agent-detail-tabs'
import { AgentDockedChat } from './agent-docked-chat'
import { AgentSetupMode } from './setup/agent-setup-mode'

interface AgentDetailViewProps {
  agent: AgentDetail
}

export function AgentDetailView({ agent }: AgentDetailViewProps) {
  const isDesktop = useMedia('(min-width: 1024px)')
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  const [autosave, setAutosave] = useState<AutosaveState>({ kind: 'idle' })

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            <AutosaveIndicator state={autosave} />
            <AgentActionsMenu
              agent={agent}
              onSavingChange={(saving) =>
                setAutosave(saving ? { kind: 'saving' } : { kind: 'saved', at: Date.now() })
              }
              onSaved={() => setAutosave({ kind: 'saved', at: Date.now() })}
            />
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Kopilot' href='/app/kopilot/new' />
          <MainPageBreadcrumbItem title='Agents' href='/app/agents' />
          <AgentBreadcrumbSwitcher activeAgent={agent} />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent
        dockedPanels={
          isDesktop
            ? [
                {
                  key: 'agent-chat',
                  content: <AgentDockedChat agentId={agent.id} />,
                  width: dockedWidth,
                  onWidthChange: setDockedWidth,
                  minWidth,
                  maxWidth,
                },
              ]
            : []
        }>
        {agent.setupCompletedAt == null ? (
          <AgentSetupMode agent={agent} />
        ) : (
          <AgentDetailTabs agent={agent} onAutosaveChange={setAutosave} />
        )}
      </MainPageContent>
    </MainPage>
  )
}
