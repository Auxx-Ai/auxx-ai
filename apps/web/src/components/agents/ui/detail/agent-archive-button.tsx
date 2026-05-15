// apps/web/src/components/agents/ui/detail/agent-archive-button.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Archive, ArchiveRestore } from 'lucide-react'
import { useConfirm } from '~/hooks/use-confirm'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import type { AgentDetail, AgentListItem } from '../../store/agent-store'

interface AgentArchiveButtonProps {
  agent: Pick<AgentDetail | AgentListItem, 'id' | 'name' | 'archivedAt'>
  onSavingChange?: (saving: boolean) => void
  onSaved?: () => void
}

export function AgentArchiveButton({ agent, onSavingChange, onSaved }: AgentArchiveButtonProps) {
  const { archiveAgent, unarchiveAgent, isUpdating } = useAgentMutations()
  const [confirm, ConfirmDialog] = useConfirm()
  const archived = agent.archivedAt != null

  const handleClick = async () => {
    if (archived) {
      onSavingChange?.(true)
      const ok = await unarchiveAgent(agent.id)
      onSavingChange?.(false)
      if (ok) onSaved?.()
      return
    }
    const ok = await confirm({
      title: 'Archive agent?',
      description: `"${agent.name ?? 'Untitled agent'}" will stop responding to mentions and triggers.`,
      confirmText: 'Archive',
      cancelText: 'Cancel',
      destructive: false,
    })
    if (!ok) return
    onSavingChange?.(true)
    const success = await archiveAgent(agent.id)
    onSavingChange?.(false)
    if (success) onSaved?.()
  }

  return (
    <>
      <ConfirmDialog />
      <Button
        variant='outline'
        size='sm'
        onClick={handleClick}
        loading={isUpdating}
        loadingText={archived ? 'Unarchiving…' : 'Archiving…'}>
        {archived ? (
          <>
            <ArchiveRestore />
            Unarchive
          </>
        ) : (
          <>
            <Archive />
            Archive
          </>
        )}
      </Button>
    </>
  )
}
