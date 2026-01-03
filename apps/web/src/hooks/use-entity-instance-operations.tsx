// apps/web/src/hooks/use-entity-instance-operations.tsx
'use client'

import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError } from '@auxx/ui/components/toast'
import { useCustomField } from '~/components/custom-fields/hooks/use-custom-field'
import { inferTypedValueFromRow, type FieldValueRow } from '@auxx/lib/field-values/client'
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
}

/** Page size for infinite query */
const PAGE_SIZE = 100

/**
 * Hook that handles entity instance CRUD operations, data fetching, and confirmations.
 * Extracts mutation and handler logic from entity-records-content.tsx.
 */
export function useEntityInstanceOperations(options: UseEntityInstanceOperationsOptions) {
  const {
    entityDefinitionId,
    resourceLabel,
    resourcePlural,
    onDrawerClose,
    onClearSelection,
  } = options

  const utils = api.useUtils()

  // Confirm dialogs
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()
  const [confirmArchive, ConfirmArchiveDialog] = useConfirm()

  // Custom field mutations
  const { create: createField } = useCustomField({
    modelType: 'entity',
    entityDefinitionId,
  })

  // ============================================================
  // Data Fetching
  // ============================================================

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = api.entityInstance.list.useInfiniteQuery(
    { entityDefinitionId: entityDefinitionId ?? '', includeArchived: false, limit: PAGE_SIZE },
    {
      enabled: !!entityDefinitionId,
      getNextPageParam: (lastPage) => lastPage?.nextCursor ?? null,
    }
  )

  /** Flatten pages to get all raw instances */
  const rawInstances = useMemo(() => {
    return data?.pages?.flatMap((page) => page.items) ?? []
  }, [data])

  /** Transform instances to have customFieldValues for column compatibility */
  const instances: EntityRow[] = useMemo(() => {
    return rawInstances.map((instance) => {
      // Convert raw FieldValue rows to objects with TypedFieldValue
      const typedValues = (instance.typedValues ?? []).map((row) => ({
        id: row.id,
        fieldId: row.fieldId,
        value: inferTypedValueFromRow(row as FieldValueRow),
      }))

      return {
        id: instance.id,
        entityDefinitionId: instance.entityDefinitionId,
        createdAt: instance.createdAt,
        updatedAt: instance.updatedAt,
        archivedAt: instance.archivedAt,
        // Cells read from store via syncer
        customFieldValues: typedValues.map((v) => ({
          fieldId: v.fieldId,
          value: null, // Values come from store, not row data
        })),
        // Converted values with TypedFieldValue for drawer display
        _originalValues: typedValues,
      }
    })
  }, [rawInstances])

  /** Handle scrolling to bottom - load more data */
  const handleScrollToBottom = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])

  // ============================================================
  // Mutations
  // ============================================================

  const archiveInstance = api.entityInstance.archive.useMutation({
    onSuccess: () => {
      utils.entityInstance.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to archive', description: error.message })
    },
  })

  const deleteInstance = api.entityInstance.delete.useMutation({
    onSuccess: () => {
      utils.entityInstance.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete', description: error.message })
    },
  })

  const bulkDeleteInstances = api.entityInstance.bulkDelete.useMutation({
    onSuccess: () => {
      utils.entityInstance.list.invalidate()
      onClearSelection?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete', description: error.message })
    },
  })

  const bulkArchiveInstances = api.entityInstance.bulkArchive.useMutation({
    onSuccess: () => {
      utils.entityInstance.list.invalidate()
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

  /** Handle delete from drawer with confirmation */
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
        deleteInstance.mutate({ id: instanceId })
        onDrawerClose?.()
      }
    },
    [confirmDelete, resourceLabel, deleteInstance, onDrawerClose]
  )

  /** Handle saving a new custom field */
  const handleSaveField = useCallback(
    async (fieldData: Record<string, unknown>) => {
      await createField.mutateAsync({
        ...fieldData,
        modelType: 'entity',
        entityDefinitionId,
      })
      utils.customField.getByEntityDefinition.invalidate({ entityDefinitionId })
    },
    [createField, entityDefinitionId, utils]
  )

  return {
    // Data
    instances,
    rawInstances,
    isLoading,
    isFetchingNextPage,
    hasNextPage,

    // Actions
    refetch,
    fetchNextPage,
    handleScrollToBottom,

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
