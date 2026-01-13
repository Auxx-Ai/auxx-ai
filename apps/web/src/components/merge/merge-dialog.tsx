// apps/web/src/components/merge/merge-dialog.tsx
'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@auxx/ui/components/dialog'
import { Button } from '@auxx/ui/components/button'
import { Kbd } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { getDefinitionId, type ResourceId } from '@auxx/lib/resources/client'
import { useResource, useRecords } from '~/components/resources'
import { api } from '~/trpc/react'
import { MergeSourcePanel } from './merge-source-panel'
import { MergeTargetPanel } from './merge-target-panel'
import { MergePreviewPanel } from './merge-preview-panel'
import { EntityIcon } from '@auxx/ui/components/icons'

interface MergeDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
  /** ResourceIds of items to merge (format: "entityDefinitionId:entityInstanceId") */
  baseResourceIds: ResourceId[]
  /** Target to merge into - defaults to first item in baseResourceIds */
  targetResourceId?: ResourceId
  /** Callback after successful merge */
  onMergeComplete?: (mergedResourceId: ResourceId) => void
}

/**
 * Dialog for merging multiple entity instances into one.
 * All items must share the same entityDefinitionId.
 */
export function MergeDialog({
  open,
  onOpenChange,
  baseResourceIds,
  targetResourceId: initialTargetId,
  onMergeComplete,
}: MergeDialogProps) {
  const utils = api.useUtils()

  // Derive entityDefinitionId from first resourceId
  const entityDefinitionId = useMemo(() => {
    if (baseResourceIds.length === 0) return null
    return getDefinitionId(baseResourceIds[0])
  }, [baseResourceIds])

  // Get resource definition for label and fields
  const { resource } = useResource(entityDefinitionId ?? '')

  // State: target and sources (sources = everything except target)
  const [targetResourceId, setTargetResourceId] = useState<ResourceId>(
    () => initialTargetId ?? baseResourceIds[0]
  )
  const [sourceResourceIds, setSourceResourceIds] = useState<ResourceId[]>(() =>
    baseResourceIds.filter((id) => id !== (initialTargetId ?? baseResourceIds[0]))
  )

  // Fetch all records for display
  const allResourceIds = useMemo(
    () => [targetResourceId, ...sourceResourceIds].filter(Boolean),
    [targetResourceId, sourceResourceIds]
  )
  const { records, isLoading: recordsLoading } = useRecords({ resourceIds: allResourceIds })

  // TODO: Replace with actual api.entityInstance.merge when ready
  // Placeholder merge mutation
  const [isPending, setIsPending] = useState(false)
  const handleMergePlaceholder = async () => {
    setIsPending(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Placeholder response
      const result = {
        mergedResourceId: targetResourceId,
        mergedCount: sourceResourceIds.length + 1,
        archivedIds: sourceResourceIds,
      }

      // Invalidate queries
      utils.entityInstance.list.invalidate()

      // Call success callback
      onMergeComplete?.(result.mergedResourceId)
      onOpenChange(false)
    } catch (error) {
      toastError({
        title: 'Failed to merge',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setIsPending(false)
    }
  }

  /** Add source items via ResourcePicker */
  const handleAddSources = useCallback(
    (newIds: ResourceId[]) => {
      setSourceResourceIds((prev) => {
        const existing = new Set(prev)
        const toAdd = newIds.filter((id) => !existing.has(id) && id !== targetResourceId)
        return [...prev, ...toAdd]
      })
    },
    [targetResourceId]
  )

  /** Remove a source item */
  const handleRemoveSource = useCallback((resourceId: ResourceId) => {
    setSourceResourceIds((prev) => prev.filter((id) => id !== resourceId))
  }, [])

  /** Swap a source item to become the target */
  const handleSetTarget = useCallback(
    (resourceId: ResourceId) => {
      setSourceResourceIds((prev) => {
        const newSources = prev.filter((id) => id !== resourceId)
        newSources.push(targetResourceId) // old target becomes source
        return newSources
      })
      setTargetResourceId(resourceId)
    },
    [targetResourceId]
  )

  /** Execute merge */
  const handleMerge = () => {
    if (sourceResourceIds.length === 0) return
    handleMergePlaceholder()
  }

  const resourceLabel = resource?.label ?? 'Record'
  const canMerge = sourceResourceIds.length > 0 && targetResourceId

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="3xl" position="tc">
        <DialogHeader>
          <DialogTitle>Merge {resourceLabel}s</DialogTitle>
          <DialogDescription>
            Select items to merge into the target {resourceLabel.toLowerCase()}. All data will be
            combined into the target.
          </DialogDescription>
        </DialogHeader>

        {/* Main content: 3-column layout */}
        <div className="flex items-stretch gap-0 min-h-[200px]">
          {/* Double-width box containing sources + target */}
          <div className="flex-[2] flex border p-1 rounded-[20px] overflow-hidden">
            {/* Source panel */}
            <MergeSourcePanel
              entityDefinitionId={entityDefinitionId}
              sourceResourceIds={sourceResourceIds}
              targetResourceId={targetResourceId}
              onAddSources={handleAddSources}
              onRemoveSource={handleRemoveSource}
              onSetAsTarget={handleSetTarget}
              isLoading={recordsLoading}
            />

            {/* Divider strip (empty) */}
            <div className="w-[50px] bg-muted/30 shrink-0 flex items-center justify-center">
              <EntityIcon variant="muted" iconId="arrow-right" size="lg" />
            </div>

            {/* Target panel */}
            <MergeTargetPanel
              resourceId={targetResourceId}
              entityDefinitionId={entityDefinitionId}
              isLoading={recordsLoading}
            />
          </div>

          {/* Equals sign strip */}
          <div className="w-[50px] shrink-0 flex items-center justify-center">
            <EntityIcon variant="muted" iconId="equal" size="lg" />
          </div>

          {/* Merged preview panel */}
          <MergePreviewPanel
            targetResourceId={targetResourceId}
            sourceResourceIds={sourceResourceIds}
            entityDefinitionId={entityDefinitionId}
            isLoading={recordsLoading}
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleMerge}
            loading={isPending}
            loadingText="Merging..."
            disabled={!canMerge}>
            Merge {sourceResourceIds.length + 1} Items
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
