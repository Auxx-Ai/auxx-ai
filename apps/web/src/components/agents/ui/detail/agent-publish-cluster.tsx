// apps/web/src/components/agents/ui/detail/agent-publish-cluster.tsx
'use client'

import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { Archive, ArchiveRestore, History, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PublishClusterShell } from '~/components/versioning/ui/publish-cluster-shell'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { type PublishAgentResult, useAgentMutations } from '../../hooks/use-agent-mutations'
import { AgentVersionsDialog } from './agent-versions-dialog'
import { PublishClampDialog } from './permissions/publish-clamp-dialog'

interface AgentPublishClusterProps {
  agentId: string
  /** Mirrors the autosave indicator while Archive/Unarchive persists. */
  onSavingChange?: (saving: boolean) => void
  onSaved?: () => void
}

const PILL_TOOLTIP =
  'Production runs version N; unsaved changes only affect the builder Chat tab and draft simulations until published.'

/**
 * Agent detail-hero publish cluster — a {@link PublishClusterShell} consumer.
 * Derives the 4-state status (Draft / Live / Live·unsaved / Archived) from
 * `agent.getById` (`activeVersionId` + `hasUnpublishedChanges` + `archivedAt`)
 * and offers Publish / Discard plus a `⌄` menu with Version history,
 * Archive/Unarchive, and permanent Delete. See plans/agents/agent-versions/ui-plan.md §2.
 */
export function AgentPublishCluster({
  agentId,
  onSavingChange,
  onSaved,
}: AgentPublishClusterProps) {
  const [isVersionsOpen, setIsVersionsOpen] = useState(false)
  // The §2.4a author clamp, held until the user dismisses it. Publishing an
  // agent above your own authority is impossible, and staying silent about the
  // downgrade is what turns that into "my agent can't do what I told it to".
  const [clamped, setClamped] = useState<PublishAgentResult | null>(null)
  const [confirm, ConfirmDialog] = useConfirm()
  const router = useRouter()
  const detail = api.agent.getById.useQuery({ agentId })
  const {
    publishAgent,
    discardChanges,
    archiveAgent,
    unarchiveAgent,
    deleteAgent,
    isPublishing,
    isDiscarding,
    isUpdating,
  } = useAgentMutations()

  const isPublished = !!detail.data?.activeVersionId
  const hasUnsaved = !!detail.data?.hasUnpublishedChanges
  const isArchived = detail.data?.archivedAt != null
  const displayName = detail.data?.name ?? 'Untitled agent'

  const handlePublish = async () => {
    const result = await publishAgent(agentId)
    if (result && result.clampReductions.length > 0) setClamped(result)
  }

  const handleDiscard = async () => {
    const ok = await confirm({
      title: 'Discard unsaved changes?',
      description: 'Your draft reverts to the live version. This cannot be undone.',
      confirmText: 'Discard',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await discardChanges(agentId)
  }

  const handleArchiveToggle = async () => {
    if (isArchived) {
      onSavingChange?.(true)
      const ok = await unarchiveAgent(agentId)
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
    const success = await archiveAgent(agentId)
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
    const success = await deleteAgent(agentId)
    if (success) router.push('/app/agents')
  }

  return (
    <>
      <PublishClusterShell
        status={{ isPublished, hasUnsaved, isArchived }}
        pillTooltip={PILL_TOOLTIP}
        publish={{ onClick: () => void handlePublish(), isPending: isPublishing }}
        discard={{ onClick: handleDiscard, isPending: isDiscarding }}>
        <DropdownMenuItem onClick={() => setIsVersionsOpen(true)}>
          <History /> Version history
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void handleArchiveToggle()} disabled={isUpdating}>
          {isArchived ? (
            <>
              <ArchiveRestore /> Unarchive
            </>
          ) : (
            <>
              <Archive /> Archive
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem variant='destructive' onClick={() => void handleDelete()}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </PublishClusterShell>

      <AgentVersionsDialog
        open={isVersionsOpen}
        onOpenChange={setIsVersionsOpen}
        agentId={agentId}
      />
      <PublishClampDialog
        open={clamped !== null}
        onOpenChange={(open) => !open && setClamped(null)}
        reductions={clamped?.clampReductions ?? []}
        versionNumber={clamped?.versionNumber ?? null}
      />
      <ConfirmDialog />
    </>
  )
}
