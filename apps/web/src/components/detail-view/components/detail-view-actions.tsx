// apps/web/src/components/detail-view/components/detail-view-actions.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { parseRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Archive, Ban, Merge, Send, Trash2, Users, Zap } from 'lucide-react'
import { useState } from 'react'
import { GranularPermissionsGate } from '~/components/mail-permissions/ui/granular-permissions-gate'
import { MergeDialog } from '~/components/merge'
import { RecordRequestAccessPopover } from '~/components/permissions/ui/record-request-access-popover'
import { useRecordAccess } from '~/components/resources'
import { AddToSequenceDialog } from '~/components/sequences/ui/add-to-sequence-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import type { DetailViewActionsProps } from '../types'
import { AppRecordActions } from './app-record-actions'

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
  const { hasAccess } = useFeatureFlags()
  const sequencesEnabled = hasAccess(FeatureKey.sequences)

  /**
   * **The per-ROW write gate** (plan v3/04 §10.4 / D5, plan v3/03 §5.2).
   *
   * This header used to ask `canEditEntity(def)` — the DEF question, which is
   * wrong for a row in both directions since P5: a member holding `edit` on one
   * row via a grant saw no Archive on that row's own page, and a member holding
   * only `read` on a row of a def they otherwise edit saw Delete. The `_access`
   * stamp riding the row is the answer, read through the same verbs the server
   * applies.
   *
   * `canEdit` and `canDelete` are deliberately NOT one flag: `canDelete` is the
   * `edit` floor **plus** (`records.delete` OR `admin`), strictly narrower.
   *
   * ⚠ **Merge is on `canDelete`, with Delete — not on `canEdit` with
   * Archive/Spam.** A merge permanently removes the source rows, and the
   * destructive half is the binding one: the server asserts the DELETE verb for
   * the target AND every source (`assertCanDeleteRows`,
   * `routers/record.ts:996`), which is also what `RecordRowAccess.canDelete`
   * means by "deleted or merged away". Archive and Spam are reversible status
   * writes and stay on the `edit` floor. Plan v3/04 §10.4 groups Merge with
   * Archive/Spam; that grouping is wrong against the shipped mutation and is
   * not followed here.
   */
  const { access, canEdit, canDelete } = useRecordAccess(recordId)
  const [confirm, ConfirmDialog] = useConfirm()
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false)
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [addToSequenceDialogOpen, setAddToSequenceDialogOpen] = useState(false)

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
      description:
        'This action cannot be undone. The record and all its data will be permanently deleted.',
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
      <div className='flex gap-2'>
        {/* Ask for the next rung (plan v3/04 §8.2, mount 2). FIRST in the row on
            purpose: everything after it is destructive-leaning, and this is the
            one control that ADDS capability. Only at `read` — reaching this page
            already proves it, and `edit`/`admin` have nothing left to ask for. */}
        {access === 'read' && (
          <GranularPermissionsGate>
            <RecordRequestAccessPopover
              entityDefinitionId={parseRecordId(recordId).entityDefinitionId}
              entityInstanceId={parseRecordId(recordId).entityInstanceId}
            />
          </GranularPermissionsGate>
        )}

        {actions.enableGroups && (
          <Button variant='outline' size='sm' onClick={() => setIsGroupDialogOpen(true)}>
            <Users /> Groups
          </Button>
        )}

        {actions.enableMerge && canDelete && (
          <Button variant='outline' size='sm' onClick={() => setMergeDialogOpen(true)}>
            <Merge /> Merge
          </Button>
        )}

        {actions.enableWorkflowTrigger && (
          <Button variant='outline' size='sm' onClick={() => console.log('Workflow:', recordId)}>
            <Zap /> Run Workflow
          </Button>
        )}

        {actions.enableAddToSequence && sequencesEnabled && (
          <Button variant='outline' size='sm' onClick={() => setAddToSequenceDialogOpen(true)}>
            <Send /> Add to sequence
          </Button>
        )}

        {actions.enableArchive && canEdit && !isArchived && (
          <Button variant='outline' size='sm' onClick={handleArchive}>
            <Archive /> Archive
          </Button>
        )}

        {actions.enableSpam && canEdit && !isSpam && (
          <Button variant='destructive' size='sm' onClick={handleSpam}>
            <Ban /> Spam
          </Button>
        )}

        {actions.enableDelete && canDelete && (
          <Button variant='destructive' size='sm' onClick={handleDelete}>
            <Trash2 /> Delete
          </Button>
        )}

        <AppRecordActions recordId={recordId} recordType={entityType} />
      </div>

      <ConfirmDialog />

      {mergeDialogOpen && recordId && (
        <MergeDialog
          open={mergeDialogOpen}
          onOpenChange={setMergeDialogOpen}
          baseRecordIds={[recordId]}
          onMergeComplete={() => setMergeDialogOpen(false)}
        />
      )}

      {sequencesEnabled && addToSequenceDialogOpen && recordId && (
        <AddToSequenceDialog
          open={addToSequenceDialogOpen}
          onOpenChange={setAddToSequenceDialogOpen}
          recipientEntityInstanceIds={[parseRecordId(recordId).entityInstanceId]}
        />
      )}
    </>
  )
}
