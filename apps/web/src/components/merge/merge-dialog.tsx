// apps/web/src/components/merge/merge-dialog.tsx
'use client'

import { getDefinitionId, type RecordId } from '@auxx/lib/resources/client'
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRecords, useResource } from '~/components/resources'
import { api } from '~/trpc/react'
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
    if (baseRecordIds.length === 0) return null
    return getDefinitionId(baseRecordIds[0])
  }, [baseRecordIds])

  // Get resource definition for label and fields
  const { resource } = useResource(entityDefinitionId ?? '')

  // State: target and sources (sources = everything except target)
  const [targetRecordId, setTargetRecordId] = useState<RecordId>(
    () => initialTargetId ?? baseRecordIds[0]
  )
  const [sourceRecordIds, setSourceRecordIds] = useState<RecordId[]>(() =>
    baseRecordIds.filter((id) => id !== (initialTargetId ?? baseRecordIds[0]))
  )
  console.log('MergeDialog sourceRecordIds:', sourceRecordIds, targetRecordId)
  // Fetch all records for display
  const allRecordIds = useMemo(
    () => [targetRecordId, ...sourceRecordIds].filter(Boolean),
    [targetRecordId, sourceRecordIds]
  )
  const { records, isLoading: recordsLoading } = useRecords({ recordIds: allRecordIds })

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
        newSources.push(targetRecordId) // old target becomes source
        return newSources
      })
      setTargetRecordId(recordId)
    },
    [targetRecordId]
  )

  /** Execute merge */
  const handleMerge = () => {
    if (sourceRecordIds.length === 0 || !targetRecordId) return

    mergeMutation.mutate({
      targetRecordId,
      sourceRecordIds,
    })
  }

  const resourceLabel = resource?.label ?? 'Record'
  const canMerge = sourceRecordIds.length > 0 && targetRecordId

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='3xl' position='tc'>
        <DialogHeader>
          <DialogTitle>Merge {resourceLabel}s</DialogTitle>
          <DialogDescription>
            Select items to merge into the target {resourceLabel.toLowerCase()}. All data will be
            combined into the target.
          </DialogDescription>
        </DialogHeader>

        {/* Main content: 3-column layout */}
        <div className='flex items-stretch gap-0 min-h-[200px]'>
          {/* Double-width box containing sources + target */}
          <div className='flex-[2] flex'>
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
            <div className='w-[50px] bg-muted/30 shrink-0 flex items-center justify-center'>
              <EntityIcon variant='muted' iconId='arrow-right' size='lg' />
            </div>

            {/* Target panel */}
            <MergeTargetPanel
              recordId={targetRecordId}
              entityDefinitionId={entityDefinitionId}
              isLoading={recordsLoading}
            />
          </div>

          {/* Equals sign strip */}
          <div className='w-[50px] shrink-0 flex items-center justify-center'>
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
