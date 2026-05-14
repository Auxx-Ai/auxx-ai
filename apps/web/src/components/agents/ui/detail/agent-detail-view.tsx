// apps/web/src/components/agents/ui/detail/agent-detail-view.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useMedia } from '~/hooks/use-media'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import type { AgentDetail } from '../../store/agent-store'
import { AgentGeneralDialog, type AgentGeneralFormValues } from '../dialogs/agent-general-dialog'
import { AutosaveIndicator, type AutosaveState } from '../shared/autosave-indicator'
import { AgentArchiveButton } from './agent-archive-button'
import { AgentBreadcrumbSwitcher } from './agent-breadcrumb-switcher'
import { AgentDetailTabs } from './agent-detail-tabs'
import { AgentDockedChat } from './agent-docked-chat'

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
            <AgentArchiveButton
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
        <AgentDetailTabs agent={agent} />
      </MainPageContent>
    </MainPage>
  )
}

interface AgentDetailNewViewProps {
  onCreated: (slug: string) => void
}

/**
 * "New agent" surface — opens the general-edit dialog by default. On submit,
 * creates the agent and hands off to the parent for navigation. On cancel,
 * routes back to the list.
 */
export function AgentDetailNewView({ onCreated }: AgentDetailNewViewProps) {
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const { createAgent, isCreating } = useAgentMutations()
  const utils = api.useUtils()

  useEffect(() => {
    if (!open) router.push('/app/agents')
  }, [open, router])

  const handleSubmit = async (values: AgentGeneralFormValues) => {
    const created = await createAgent({
      name: values.name,
      slug: values.slug,
      description: values.description || null,
    })
    if (!created) return
    await utils.agent.list.invalidate()
    setOpen(false)
    onCreated(created.slug)
  }

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Kopilot' href='/app/kopilot/new' />
          <MainPageBreadcrumbItem title='Agents' href='/app/agents' />
          <MainPageBreadcrumbItem title='New' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <div className='p-6 text-sm text-muted-foreground'>Creating new agent…</div>
        <AgentGeneralDialog
          open={open}
          onOpenChange={setOpen}
          mode='create'
          isSubmitting={isCreating}
          onSubmit={handleSubmit}
        />
      </MainPageContent>
    </MainPage>
  )
}
