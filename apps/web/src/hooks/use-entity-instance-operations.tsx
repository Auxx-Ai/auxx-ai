// apps/web/src/hooks/use-entity-instance-operations.tsx
'use client'

import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useRef } from 'react'
import type { EntityRow } from '~/app/(protected)/app/custom/[slug]/_components/types'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/**
 * Options for useEntityInstanceOperations hook
 */
interface UseEntityInstanceOperationsOptions {
  /** Entity definition ID for building RecordIds */
  entityDefinitionId: string | undefined
  /** Singular resource label for dialog messages */
  resourceLabel?: string
  /** Plural resource label for dialog messages */
  resourcePlural?: string
  /** Callback when drawer should close after delete */
  onDrawerClose?: () => void
  /** Callback when row selection should be cleared */
  onClearSelection?: () => void
  /** Callback to refresh data after mutations */
  onRefetch?: () => void
}

/**
 * Hook that handles entity instance mutation operations and confirmations.
 * Data fetching is handled separately via useRecordList in the parent component.
 *
 * Uses api.record.* endpoints with RecordId format.
 */
export function useEntityInstanceOperations(options: UseEntityInstanceOperationsOptions) {
  const {
    entityDefinitionId,
    resourceLabel,
    resourcePlural,
    onDrawerClose,
    onClearSelection,
    onRefetch,
  } = options

  // Confirm dialogs
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()
  const [confirmArchive, ConfirmArchiveDialog] = useConfirm()

  /**
   * Helper to build RecordId from instance ID
   */
  const buildRecordId = useCallback(
    (instanceId: string): RecordId => {
      if (!entityDefinitionId) {
        throw new Error('entityDefinitionId is required for record operations')
      }
      return toRecordId(entityDefinitionId, instanceId)
    },
    [entityDefinitionId]
  )

  // ============================================================
  // Mutations
  // ============================================================

  const archiveInstance = api.record.archive.useMutation({
    onSuccess: () => {
      onRefetch?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to archive', description: error.message })
    },
  })

  const deleteInstance = api.record.delete.useMutation({
    onSuccess: () => {
      onRefetch?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete', description: error.message })
    },
  })

  // Refs for stable callback access (avoids recreating callbacks when mutations change)
  const deleteInstanceRef = useRef(deleteInstance)
  deleteInstanceRef.current = deleteInstance

  const bulkDeleteInstances = api.record.bulkDelete.useMutation({
    onSuccess: () => {
      onRefetch?.()
      onClearSelection?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete', description: error.message })
    },
  })

  const bulkArchiveInstances = api.record.bulkArchive.useMutation({
    onSuccess: () => {
      onRefetch?.()
      onClearSelection?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to archive', description: error.message })
    },
  })

  // ============================================================
  // Handlers
  // ============================================================

  /** Handle archive action with confirmation */
  const handleArchive = useCallback(
    async (instanceId: string) => {
      const confirmed = await confirmArchive({
        title: `Archive ${resourceLabel ?? 'Record'}`,
        description: `Are you sure you want to archive this ${resourceLabel?.toLowerCase() ?? 'record'}? You can restore it later.`,
        confirmText: 'Archive',
        cancelText: 'Cancel',
        destructive: false,
      })
      if (confirmed) {
        archiveInstance.mutate({ recordId: buildRecordId(instanceId) })
      }
    },
    [confirmArchive, resourceLabel, archiveInstance, buildRecordId]
  )

  /** Handle delete action with confirmation */
  const handleDelete = useCallback(
    async (instanceId: string) => {
      const confirmed = await confirmDelete({
        title: `Delete ${resourceLabel ?? 'Record'}`,
        description: `Are you sure you want to permanently delete this ${resourceLabel?.toLowerCase() ?? 'record'}? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        deleteInstance.mutate({ recordId: buildRecordId(instanceId) })
      }
    },
    [confirmDelete, resourceLabel, deleteInstance, buildRecordId]
  )

  /** Handle bulk delete action with confirmation */
  const handleBulkDelete = useCallback(
    async (rows: EntityRow[]) => {
      const count = rows.length
      const confirmed = await confirmDelete({
        title: `Delete ${count} ${count === 1 ? resourceLabel : resourcePlural}`,
        description: `Are you sure you want to permanently delete ${count} ${count === 1 ? resourceLabel?.toLowerCase() : resourcePlural?.toLowerCase()}? This action cannot be undone.`,
        confirmText: `Delete ${count} ${count === 1 ? resourceLabel : resourcePlural}`,
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        await bulkDeleteInstances.mutateAsync({
          recordIds: rows.map((r) => buildRecordId(r.id)),
        })
      }
    },
    [confirmDelete, resourceLabel, resourcePlural, bulkDeleteInstances, buildRecordId]
  )

  /** Handle bulk archive action with confirmation */
  const handleBulkArchive = useCallback(
    async (rows: EntityRow[]) => {
      const count = rows.length
      const confirmed = await confirmArchive({
        title: `Archive ${count} ${count === 1 ? resourceLabel : resourcePlural}`,
        description: `Are you sure you want to archive ${count} ${count === 1 ? resourceLabel?.toLowerCase() : resourcePlural?.toLowerCase()}? You can restore them later.`,
        confirmText: 'Archive',
        cancelText: 'Cancel',
        destructive: false,
      })
      if (confirmed) {
        await bulkArchiveInstances.mutateAsync({
          recordIds: rows.map((r) => buildRecordId(r.id)),
        })
      }
    },
    [confirmArchive, resourceLabel, resourcePlural, bulkArchiveInstances, buildRecordId]
  )

  /** Handle delete from drawer with confirmation (uses ref for stable callback) */
  const handleDrawerDelete = useCallback(
    async (instanceId: string) => {
      const confirmed = await confirmDelete({
        title: `Delete ${resourceLabel ?? 'Record'}`,
        description: `Are you sure you want to permanently delete this ${resourceLabel?.toLowerCase() ?? 'record'}? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        deleteInstanceRef.current.mutate({ recordId: buildRecordId(instanceId) })
        onDrawerClose?.()
      }
    },
    [confirmDelete, resourceLabel, onDrawerClose, buildRecordId]
  )

  return {
    // Single instance operations
    handleArchive,
    handleDelete,
    handleDrawerDelete,

    // Bulk operations
    handleBulkDelete,
    handleBulkArchive,

    // Dialog components (must be rendered in JSX)
    ConfirmDeleteDialog,
    ConfirmArchiveDialog,
  }
}
