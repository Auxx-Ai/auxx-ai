// apps/web/src/components/agents/procedures/ui/procedure-publish-cluster.tsx
'use client'

import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { useNavStack } from '@auxx/ui/components/nav-stack'
import { History, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { PublishClusterShell } from '~/components/versioning/ui/publish-cluster-shell'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useProcedure } from '../hooks/use-procedure'
import { useProcedureMutations } from '../hooks/use-procedure-mutations'
import { ProcedureVersionsDialog } from './procedure-versions-dialog'

interface ProcedurePublishClusterProps {
  procedureId: string
  /** Bumped after restore/discard so the editor canvas remounts onto the new draft. */
  onReload?: () => void
}

/**
 * Procedure publish cluster — a {@link PublishClusterShell} consumer. Derives a
 * three-state status (Draft / Live / Live·unsaved) from `meta.activeVersionId` +
 * `meta.hasUnpublishedChanges`, gates publish on a non-empty `whenToUse`, and
 * offers Discard + a `⌄` menu (Version history + org-wide Delete with a
 * blast-radius confirm). No archive/unpublish — procedures have a simpler
 * lifecycle. See plans/agents/agent-versions/ui-plan.md §3.1.
 */
export function ProcedurePublishCluster({ procedureId, onReload }: ProcedurePublishClusterProps) {
  const [isVersionsOpen, setIsVersionsOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const { pop } = useNavStack()
  const utils = api.useUtils()

  const { meta } = useProcedure(procedureId)
  const { publish, discardDraft, deleteProcedure, isPublishing, isDiscarding, isDeleting } =
    useProcedureMutations()

  const isPublished = !!meta?.activeVersionId
  const hasUnsaved = !!meta?.hasUnpublishedChanges
  const whenToUseEmpty = (meta?.whenToUse ?? '').trim() === ''

  const handleDiscard = async () => {
    const ok = await confirm({
      title: 'Discard unsaved changes?',
      description: 'Your draft reverts to the live version. This cannot be undone.',
      confirmText: 'Discard',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    const success = await discardDraft(procedureId)
    if (success) onReload?.()
  }

  const handleDelete = async () => {
    const count = await utils.procedure.agentUsageCount.fetch({ id: procedureId })
    const ok = await confirm({
      title: `Delete ${meta?.name ?? 'procedure'}?`,
      description:
        count > 0
          ? `It's used by ${count} agent${count === 1 ? '' : 's'} and will be removed from all of them. This cannot be undone.`
          : "It isn't used by any agent. This cannot be undone.",
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    const success = await deleteProcedure(procedureId)
    if (success) pop()
  }

  return (
    <>
      <PublishClusterShell
        status={{ isPublished, hasUnsaved }}
        publish={{
          onClick: () => void publish(procedureId),
          isPending: isPublishing,
          disabledReason: whenToUseEmpty ? 'Set "when to use" before publishing' : undefined,
        }}
        discard={{ onClick: handleDiscard, isPending: isDiscarding }}>
        <DropdownMenuItem onClick={() => setIsVersionsOpen(true)}>
          <History /> Version history
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleDelete} variant='destructive' disabled={isDeleting}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </PublishClusterShell>

      <ProcedureVersionsDialog
        open={isVersionsOpen}
        onOpenChange={setIsVersionsOpen}
        procedureId={procedureId}
        onReload={onReload}
      />
      <ConfirmDialog />
    </>
  )
}
