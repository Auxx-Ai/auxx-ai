// apps/web/src/components/agents/ui/detail/agent-actions-menu.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Archive, ArchiveRestore, MoreVertical, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '~/hooks/use-confirm'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import type { AgentDetail, AgentListItem } from '../../store/agent-store'

interface AgentActionsMenuProps {
  agent: Pick<AgentDetail | AgentListItem, 'id' | 'name' | 'archivedAt'>
  onSavingChange?: (saving: boolean) => void
  onSaved?: () => void
}

/**
 * Upper-right actions menu on the agent detail page. Holds Archive/Unarchive
 * and permanent Delete. Archive/Unarchive drive the autosave indicator via the
 * `onSavingChange` / `onSaved` callbacks; Delete navigates back to the list.
 */
export function AgentActionsMenu({ agent, onSavingChange, onSaved }: AgentActionsMenuProps) {
  const router = useRouter()
  const { archiveAgent, unarchiveAgent, deleteAgent, isUpdating } = useAgentMutations()
  const [confirm, ConfirmDialog] = useConfirm()
  const archived = agent.archivedAt != null
  const displayName = agent.name ?? 'Untitled agent'

  const handleArchiveToggle = async () => {
    if (archived) {
      onSavingChange?.(true)
      const ok = await unarchiveAgent(agent.id)
      onSavingChange?.(false)
      if (ok) onSaved?.()
      return
    }
    const ok = await confirm({
      title: 'Archive agent?',
      description: `"${displayName}" will stop responding to mentions and triggers.`,
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

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete agent permanently?',
      description: `"${displayName}" and its triggers will be permanently removed. This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    const success = await deleteAgent(agent.id)
    if (success) router.push('/app/agents')
  }

  return (
    <>
      <ConfirmDialog />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='outline' size='icon-sm' loading={isUpdating}>
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={() => void handleArchiveToggle()}>
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
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onClick={() => void handleDelete()}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
