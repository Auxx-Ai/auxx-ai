// apps/web/src/components/merge/merge-dialog.tsx
'use client'

import { getDefinitionId, getInstanceId, type RecordId } from '@auxx/lib/resources/client'
import { toRecordId } from '@auxx/types/resource'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Kbd } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRecords, useResource } from '~/components/resources'
import { useNormalizedDefinitionId } from '~/components/resources/utils/normalize-record-id'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { countGrantedActors } from './grant-count'
import { MergePreviewPanel } from './merge-preview-panel'
import { MergeSourcePanel } from './merge-source-panel'
import { MergeTargetPanel } from './merge-target-panel'

interface MergeDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
  /** RecordIds of items to merge (format: "entityDefinitionId:entityInstanceId") */
  baseRecordIds: RecordId[]
  /** Target to merge into - defaults to first item in baseRecordIds */
  targetRecordId?: RecordId
  /** Callback after successful merge */
  onMergeComplete?: (mergedRecordId: RecordId) => void
}

/**
 * Dialog for merging multiple entity instances into one.
 * All items must share the same entityDefinitionId.
 */
export function MergeDialog({
  open,
  onOpenChange,
  baseRecordIds,
  targetRecordId: initialTargetId,
  onMergeComplete,
}: MergeDialogProps) {
  const utils = api.useUtils()

  // Derive entityDefinitionId from first recordId
  const entityDefinitionId = useMemo(() => {
    const first = baseRecordIds[0]
    return first ? getDefinitionId(first) : null
  }, [baseRecordIds])

  // Get resource definition for label and fields
  const { resource } = useResource(entityDefinitionId ?? '')

  // State: target and sources (sources = everything except target)
  // Undefined only when opened with an empty `baseRecordIds` — the dialog
  // renders nothing in that case (guard below).
  const [targetRecordId, setTargetRecordId] = useState<RecordId | undefined>(
    () => initialTargetId ?? baseRecordIds[0]
  )
  const [sourceRecordIds, setSourceRecordIds] = useState<RecordId[]>(() =>
    baseRecordIds.filter((id) => id !== (initialTargetId ?? baseRecordIds[0]))
  )
  // Fetch all records for display
  const allRecordIds = useMemo(
    () => (targetRecordId ? [targetRecordId, ...sourceRecordIds] : sourceRecordIds),
    [targetRecordId, sourceRecordIds]
  )
  const { records, isLoading: recordsLoading } = useRecords({ recordIds: allRecordIds })

  // Per-row DELETE gate — merge permanently removes the source records, so the
  // server asserts the delete verb PER ROW for the target and every source
  // (`assertCanDeleteRows` in record.merge). Mirror that here from each row's
  // server-resolved `_access` stamp, with the member's def rung as the
  // unstamped fallback — the same resolution as `useRecordAccessAt`.
  const { canDeleteRecordAt, recordDefRung } = useAccess()
  const normalizedDefId = useNormalizedDefinitionId(entityDefinitionId ?? '')
  const canDeleteAll = useMemo(() => {
    const defRung = (normalizedDefId ? recordDefRung(normalizedDefId) : undefined) ?? 'none'
    return records.every((record) => canDeleteRecordAt(record?._access ?? defRung))
  }, [records, normalizedDefId, recordDefRung, canDeleteRecordAt])

  // Grant warning (contacts only): record-level grants on the TARGET widen with
  // the merge — the grantee's contact lens fans out over the merged threads.
  // ResourceAccess keys contact grants by the fixed 'contact' slug (the mail
  // keyspace), and `forInstance` is the same read the share surfaces use — the
  // server gates it on "may the caller SEE the target", which merging requires
  // anyway. Source-contact grants stay on the archived sources (nothing
  // transfers them), so only the target's grants matter here.
  const isContactMerge = resource?.entityType === 'contact'
  const { data: targetAccessRows } = api.resourceAccess.forInstance.useQuery(
    { recordId: targetRecordId ? toRecordId('contact', getInstanceId(targetRecordId)) : '' },
    { enabled: open && isContactMerge && !!targetRecordId }
  )
  const targetGrantCount = useMemo(
    () => (isContactMerge ? countGrantedActors(targetAccessRows ?? []) : 0),
    [isContactMerge, targetAccessRows]
  )

  // Reset state when dialog closes
  useEffect(() => {
    if (!open && baseRecordIds.length > 0) {
      // Reset to initial values when dialog closes
      const resetTarget = initialTargetId ?? baseRecordIds[0]!
      setTargetRecordId(resetTarget)
      setSourceRecordIds(baseRecordIds.filter((id) => id !== resetTarget))
    }
  }, [open, baseRecordIds, initialTargetId])

  // Merge mutation
  const mergeMutation = api.record.merge.useMutation({
    onSuccess: (result) => {
      // Invalidate queries to refresh data
      utils.record.listFiltered.invalidate()
      utils.record.search.invalidate()

      // Call success callback
      onMergeComplete?.(result.mergedRecordId)
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({
        title: 'Failed to merge',
        description: error.message,
      })
    },
  })

  /** Add source items via RecordPicker */
  const handleAddSources = useCallback(
    (newIds: RecordId[]) => {
      setSourceRecordIds((prev) => {
        const existing = new Set(prev)
        const toAdd = newIds.filter((id) => !existing.has(id) && id !== targetRecordId)
        return [...prev, ...toAdd]
      })
    },
    [targetRecordId]
  )

  /** Remove a source item */
  const handleRemoveSource = useCallback((recordId: RecordId) => {
    setSourceRecordIds((prev) => prev.filter((id) => id !== recordId))
  }, [])

  /** Swap a source item to become the target */
  const handleSetTarget = useCallback(
    (recordId: RecordId) => {
      setSourceRecordIds((prev) => {
        const newSources = prev.filter((id) => id !== recordId)
        if (targetRecordId) newSources.push(targetRecordId) // old target becomes source
        return newSources
      })
      setTargetRecordId(recordId)
    },
    [targetRecordId]
  )

  /** Execute merge */
  const handleMerge = () => {
    if (sourceRecordIds.length === 0 || !targetRecordId || !canDeleteAll) return

    mergeMutation.mutate({
      targetRecordId,
      sourceRecordIds,
    })
  }

  const resourceLabel = resource?.label ?? 'Record'
  const canMerge = sourceRecordIds.length > 0 && canDeleteAll

  // Nothing to merge into — every caller mounts this dialog with a selection.
  if (!targetRecordId) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='3xl' position='tc'>
        <DialogHeader>
          <DialogTitle>Merge {resourceLabel}s</DialogTitle>
          <DialogDescription>
            Select items to merge into the target {resourceLabel.toLowerCase()}. All data will be
            combined into the target, and the source records will be permanently archived.
          </DialogDescription>
        </DialogHeader>

        {/* Main content: 3-column layout */}
        <div className='flex flex-col sm:flex-row sm:items-stretch gap-4 sm:gap-0 min-h-0 sm:min-h-[200px]'>
          {/* Double-width box containing sources + target */}
          <div className='flex-[2] flex flex-col sm:flex-row'>
            {/* Source panel */}
            <MergeSourcePanel
              entityDefinitionId={entityDefinitionId}
              sourceRecordIds={sourceRecordIds}
              targetRecordId={targetRecordId}
              onAddSources={handleAddSources}
              onRemoveSource={handleRemoveSource}
              onSetAsTarget={handleSetTarget}
              isLoading={recordsLoading}
            />

            {/* Divider strip (empty) */}
            <div className='h-[40px] sm:h-auto sm:w-[50px] bg-muted/30 shrink-0 flex items-center justify-center'>
              <EntityIcon
                variant='muted'
                iconId='arrow-right'
                size='lg'
                className='rotate-90 sm:rotate-0'
              />
            </div>

            {/* Target panel */}
            <MergeTargetPanel
              recordId={targetRecordId}
              entityDefinitionId={entityDefinitionId}
              isLoading={recordsLoading}
            />
          </div>

          {/* Equals sign strip */}
          <div className='h-[40px] sm:h-auto sm:w-[50px] shrink-0 flex items-center justify-center'>
            <EntityIcon variant='muted' iconId='equal' size='lg' />
          </div>

          {/* Merged preview panel */}
          <MergePreviewPanel
            targetRecordId={targetRecordId}
            sourceRecordIds={sourceRecordIds}
            entityDefinitionId={entityDefinitionId}
            isLoading={recordsLoading}
          />
        </div>

        {/* Non-blocking notice: merging widens existing record-level grants on
            the target to cover the merged conversation history. */}
        {targetGrantCount > 0 && (
          <Alert variant='warning'>
            <Users />
            <AlertDescription>
              {targetGrantCount === 1
                ? '1 person has access'
                : `${targetGrantCount} people have access`}{' '}
              to this contact&apos;s conversations — merging extends their access to the merged
              contact&apos;s threads. Sharing on the source contacts is not carried over.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={mergeMutation.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='default'
            size='sm'
            onClick={handleMerge}
            loading={mergeMutation.isPending}
            loadingText='Merging...'
            disabled={!canMerge}>
            Merge {sourceRecordIds.length + 1} Items
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
