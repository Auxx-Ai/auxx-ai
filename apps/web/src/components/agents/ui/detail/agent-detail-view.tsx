// apps/web/src/components/agents/ui/detail/agent-detail-view.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
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
import { Eye, MessageSquare, Share2 } from 'lucide-react'
import { useState } from 'react'
import { InstanceShareDialog } from '~/components/permissions/ui/instance-share-dialog'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { useDockStore } from '~/stores/dock-store'
import { useAgentAccess } from '../../hooks/use-agent-access'
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
  const [shareOpen, setShareOpen] = useState(false)
  // Per-agent instance access (plan 25 §4.2.DECIDED). `admin` owns Share,
  // Publish/Archive/Delete; `edit` owns the draft (autosave + discard); `view`
  // is *usable* — the page still opens, the docked chat still works, and the
  // header carries a "View only" badge instead of authoring chrome.
  const { canEdit, canAdmin } = useAgentAccess(agent.id)
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
            {canEdit && <AutosaveIndicator state={autosave} />}
            {!canEdit && (
              <Badge variant='outline' size='sm' className='shrink-0'>
                <Eye />
                View only
              </Badge>
            )}
            {canAdmin && (
              <>
                <Button variant='outline' size='sm' onClick={() => setShareOpen(true)}>
                  <Share2 />
                  Share
                </Button>
                <InstanceShareDialog
                  recordId={toRecordId('agent', agent.id)}
                  open={shareOpen}
                  onOpenChange={setShareOpen}
                />
              </>
            )}
            {canEdit &&
              (agent.setupCompletedAt != null ? (
                <AgentPublishCluster
                  agentId={agent.id}
                  canAdmin={canAdmin}
                  onSavingChange={(saving) =>
                    setAutosave(saving ? { kind: 'saving' } : { kind: 'saved', at: Date.now() })
                  }
                  onSaved={() => setAutosave({ kind: 'saved', at: Date.now() })}
                />
              ) : (
                <AgentSetupDiscardButton agentId={agent.id} name={agent.name} />
              ))}
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
