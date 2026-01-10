// apps/web/src/hooks/use-entity-instance-operations.tsx
'use client'

import { useCallback, useRef } from 'react'
import { api } from '~/trpc/react'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError } from '@auxx/ui/components/toast'
import { useCustomField } from '~/components/custom-fields/hooks/use-custom-field'
import type { EntityRow } from '~/app/(protected)/app/custom/[slug]/_components/types'

/**
 * Options for useEntityInstanceOperations hook
 */
interface UseEntityInstanceOperationsOptions {
  /** Entity definition ID for queries */
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

  const utils = api.useUtils()

  // Confirm dialogs
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()
  const [confirmArchive, ConfirmArchiveDialog] = useConfirm()

  // Custom field mutations
  const { create: createField } = useCustomField({
    modelType: 'entity',
    entityDefinitionId,
    skipFetch: true,
  })

  // ============================================================
  // Mutations
  // ============================================================

  const archiveInstance = api.entityInstance.archive.useMutation({
    onSuccess: () => {
      onRefetch?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to archive', description: error.message })
    },
  })

  const deleteInstance = api.entityInstance.delete.useMutation({
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

  const bulkDeleteInstances = api.entityInstance.bulkDelete.useMutation({
    onSuccess: () => {
      onRefetch?.()
      onClearSelection?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete', description: error.message })
    },
  })

  const bulkArchiveInstances = api.entityInstance.bulkArchive.useMutation({
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
        archiveInstance.mutate({ id: instanceId })
      }
    },
    [confirmArchive, resourceLabel, archiveInstance]
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
        deleteInstance.mutate({ id: instanceId })
      }
    },
    [confirmDelete, resourceLabel, deleteInstance]
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
        await bulkDeleteInstances.mutateAsync({ ids: rows.map((r) => r.id) })
      }
    },
    [confirmDelete, resourceLabel, resourcePlural, bulkDeleteInstances]
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
        await bulkArchiveInstances.mutateAsync({ ids: rows.map((r) => r.id) })
      }
    },
    [confirmArchive, resourceLabel, resourcePlural, bulkArchiveInstances]
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
        deleteInstanceRef.current.mutate({ id: instanceId })
        onDrawerClose?.()
      }
    },
    [confirmDelete, resourceLabel, onDrawerClose]
  )

  /** Handle saving a new custom field */
  const handleSaveField = useCallback(
    async (fieldData: Record<string, unknown>) => {
      await createField.mutateAsync({
        ...fieldData,
        modelType: 'entity',
        entityDefinitionId,
      })
      // Invalidate custom fields query
      utils.customField.getByEntityDefinition.invalidate({ entityDefinitionId })
      // Also refresh data to pick up new column
      onRefetch?.()
    },
    [createField, entityDefinitionId, utils, onRefetch]
  )

  return {
    // Single instance operations
    handleArchive,
    handleDelete,
    handleDrawerDelete,

    // Bulk operations
    handleBulkDelete,
    handleBulkArchive,

    // Custom field operations
    handleSaveField,
    isCreatingField: createField.isPending,

    // Dialog components (must be rendered in JSX)
    ConfirmDeleteDialog,
    ConfirmArchiveDialog,
  }
}
