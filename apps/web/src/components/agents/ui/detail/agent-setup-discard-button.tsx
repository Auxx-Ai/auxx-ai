// apps/web/src/components/agents/ui/detail/agent-setup-discard-button.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '~/hooks/use-confirm'
import { useAgentMutations } from '../../hooks/use-agent-mutations'

interface AgentSetupDiscardButtonProps {
  agentId: string
  name: string | null
}

/**
 * Setup-mode header action — the single "Discard draft" button shown before an
 * agent finishes setup (`setupCompletedAt == null`). Hard-deletes the unfinished
 * draft and returns to the agents list. Post-setup, Archive/Delete live in the
 * {@link AgentPublishCluster} menu instead.
 */
export function AgentSetupDiscardButton({ agentId, name }: AgentSetupDiscardButtonProps) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()
  const { deleteSetupDraft } = useAgentMutations()
  const displayName = name ?? 'Untitled agent'

  const handleDiscard = async () => {
    const ok = await confirm({
      title: 'Discard draft?',
      description: `"${displayName}" hasn't been finished. This permanently deletes it.`,
      confirmText: 'Discard',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    const success = await deleteSetupDraft(agentId)
    if (success) router.push('/app/agents')
  }

  return (
    <>
      <ConfirmDialog />
      <Button variant='outline' size='sm' onClick={() => void handleDiscard()}>
        <Trash2 /> Discard draft
      </Button>
    </>
  )
}
