// apps/web/src/components/detail-view/components/detail-view-actions.tsx
'use client'

import { useState } from 'react'
import { Archive, Ban, Merge, Trash2, Users, Zap } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { useConfirm } from '~/hooks/use-confirm'
import type { DetailViewActionsProps } from '../types'

/**
 * DetailViewActions - action buttons for the detail view header
 * Actions are enabled/disabled based on config.actions
 */
export function DetailViewActions({
  entityType,
  recordId,
  record,
  config,
}: DetailViewActionsProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false)

  const { actions } = config

  // Check if record is in a state that prevents actions
  const status = record.status as string | undefined
  const isMerged = status === 'MERGED'
  const isSpam = status === 'SPAM'
  const isArchived = status === 'ARCHIVED'

  // Don't show actions for merged records
  if (isMerged) return null

  /** Handle archive action */
  const handleArchive = async () => {
    const confirmed = await confirm({
      title: 'Archive record?',
      description: 'This record will be archived and hidden from default views.',
      confirmText: 'Archive',
      cancelText: 'Cancel',
    })
    if (confirmed) {
      // TODO: Implement archive mutation
      console.log('Archive:', recordId)
    }
  }

  /** Handle delete action */
  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete record?',
      description: 'This action cannot be undone. The record and all its data will be permanently deleted.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      // TODO: Implement delete mutation
      console.log('Delete:', recordId)
    }
  }

  /** Handle spam action */
  const handleSpam = async () => {
    const confirmed = await confirm({
      title: 'Mark as spam?',
      description: 'This record will be marked as spam.',
      confirmText: 'Mark as Spam',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      // TODO: Implement spam mutation
      console.log('Spam:', recordId)
    }
  }

  return (
    <>
      <div className="flex gap-2">
        {actions.enableGroups && (
          <Button variant="outline" size="sm" onClick={() => setIsGroupDialogOpen(true)}>
            <Users /> Groups
          </Button>
        )}

        {actions.enableMerge && (
          <Button variant="outline" size="sm" onClick={() => console.log('Merge:', recordId)}>
            <Merge /> Merge
          </Button>
        )}

        {actions.enableWorkflowTrigger && (
          <Button variant="outline" size="sm" onClick={() => console.log('Workflow:', recordId)}>
            <Zap /> Run Workflow
          </Button>
        )}

        {actions.enableArchive && !isArchived && (
          <Button variant="outline" size="sm" onClick={handleArchive}>
            <Archive /> Archive
          </Button>
        )}

        {actions.enableSpam && !isSpam && (
          <Button variant="destructive" size="sm" onClick={handleSpam}>
            <Ban /> Spam
          </Button>
        )}

        {actions.enableDelete && (
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 /> Delete
          </Button>
        )}
      </div>

      <ConfirmDialog />
    </>
  )
}
