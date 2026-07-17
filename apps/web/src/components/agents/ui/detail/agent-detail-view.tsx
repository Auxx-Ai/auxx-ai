// apps/web/src/components/agents/ui/detail/agent-detail-view.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { useDockStore } from '~/stores/dock-store'
import type { AgentDetail } from '../../store/agent-store'
import { AutosaveIndicator, type AutosaveState } from '../shared/autosave-indicator'
import { AgentBreadcrumbSwitcher } from './agent-breadcrumb-switcher'
import { AgentDetailTabs } from './agent-detail-tabs'
import { AgentDockedChat } from './agent-docked-chat'
import { AgentPublishCluster } from './agent-publish-cluster'
import { AgentSetupDiscardButton } from './agent-setup-discard-button'
import { AgentSetupMode } from './setup/agent-setup-mode'

interface AgentDetailViewProps {
  agent: AgentDetail
}

export function AgentDetailView({ agent }: AgentDetailViewProps) {
  const [autosave, setAutosave] = useState<AutosaveState>({ kind: 'idle' })
  // AgentDockedChat has no chrome of its own (unlike DockableDrawer-based panels
  // elsewhere), so below the desktop breakpoint it needs an explicit trigger +
  // drawer wrapper rather than branching on its own isDocked prop.
  const [chatOverlayOpen, setChatOverlayOpen] = useState(false)
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  const chatContent = <AgentDockedChat agentId={agent.id} />

  const { dockedPanels, overlays, isDocked } = useDockedPanels([
    {
      key: 'agent-chat',
      // Docked: always visible, matching the pre-hook behavior (no toggle).
      // Overlay: only when the mobile trigger opens it.
      open: { docked: true, overlay: chatOverlayOpen },
      content: chatContent,
      overlay: (
        <DockableDrawer
          open={chatOverlayOpen}
          onOpenChange={setChatOverlayOpen}
          isDocked={false}
          width={dockedWidth}
          onWidthChange={setDockedWidth}
          minWidth={minWidth}
          maxWidth={maxWidth}
          title='Agent chat'>
          <DrawerHeader
            icon={<MessageSquare className='size-4' />}
            title='Agent chat'
            onClose={() => setChatOverlayOpen(false)}
          />
          {chatContent}
        </DockableDrawer>
      ),
    },
  ])

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            {!isDocked && (
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label='Open agent chat'
                onClick={() => setChatOverlayOpen(true)}>
                <MessageSquare />
              </Button>
            )}
            <AutosaveIndicator state={autosave} />
            {agent.setupCompletedAt != null ? (
              <AgentPublishCluster
                agentId={agent.id}
                onSavingChange={(saving) =>
                  setAutosave(saving ? { kind: 'saving' } : { kind: 'saved', at: Date.now() })
                }
                onSaved={() => setAutosave({ kind: 'saved', at: Date.now() })}
              />
            ) : (
              <AgentSetupDiscardButton agentId={agent.id} name={agent.name} />
            )}
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Kopilot' href='/app/kopilot/new' />
          <MainPageBreadcrumbItem title='Agents' href='/app/agents' />
          <AgentBreadcrumbSwitcher activeAgent={agent} />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent dockedPanels={dockedPanels}>
        {agent.setupCompletedAt == null ? (
          <AgentSetupMode agent={agent} />
        ) : (
          <AgentDetailTabs agent={agent} onAutosaveChange={setAutosave} />
        )}
      </MainPageContent>

      {overlays}
    </MainPage>
  )
}
