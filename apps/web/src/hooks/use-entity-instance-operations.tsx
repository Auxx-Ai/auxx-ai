// apps/web/src/hooks/use-entity-instance-operations.tsx
'use client'

import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import type { EntityRow } from '~/app/(protected)/app/custom/[slug]/_components/types'
import { useRecordStore } from '~/components/resources/store/record-store'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/**
 * Options for useEntityInstanceOperations hook
 */
interface UseEntityInstanceOperationsOptions {
  /** Entity definition ID for building RecordIds */
  entityDefinitionId: string | undefined
  /**
   * System entity type (e.g. 'invoice') — lets the hook special-case entities whose delete
   * needs to run through a bespoke lifecycle mutation instead of the generic `record.delete`
   * (money MI1 build spec §G.5 — `deleteInvoice` unstamps gathered source lines + blocks while
   * payments exist; the generic delete would bypass that).
   */
  entityType?: string
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
    entityType,
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
    onSuccess: (_data, variables) => {
      const { entityDefinitionId: defId, entityInstanceId } = parseRecordId(variables.recordId)
      useRecordStore.getState().removeRecord(defId, entityInstanceId)
      onRefetch?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete', description: error.message })
    },
  })

  const bulkDeleteInstances = api.record.bulkDelete.useMutation({
    onSuccess: () => {
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

  // ⚠️ Money MI1 build spec §G.5: the generic drawer delete (`record.delete`) would bypass
  // `deleteInvoice`'s payments guard + source-line unstamp. Minimal override — no new
  // registry machinery — branch on `entityType` in `handleDrawerDelete` below.
  const deleteInvoiceInstance = api.money.deleteInvoice.useMutation({
    onSuccess: (_data, variables) => {
      const { entityInstanceId } = parseRecordId(variables.invoiceRecordId)
      if (entityDefinitionId)
        useRecordStore.getState().removeRecord(entityDefinitionId, entityInstanceId)
      onRefetch?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete invoice', description: error.message })
    },
  })

  // react-query's useMutation returns a NEW wrapper object every render, but the
  // bound .mutate / .mutateAsync fns are stable for the observer's lifetime.
  // Depend on these (never the wrapper) in the handlers below so the handlers —
  // and therefore the records-table `primaryCellRender`, which closes over
  // handleArchive/handleDelete — keep a stable identity across unrelated
  // re-renders. See use-save-field-value.ts for the same pattern.
  const { mutate: archiveMutate } = archiveInstance
  const { mutate: deleteMutate } = deleteInstance
  const { mutate: deleteInvoiceMutate } = deleteInvoiceInstance
  const { mutateAsync: bulkDeleteMutateAsync } = bulkDeleteInstances
  const { mutateAsync: bulkArchiveMutateAsync } = bulkArchiveInstances

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
        archiveMutate({ recordId: buildRecordId(instanceId) })
      }
    },
    [confirmArchive, resourceLabel, archiveMutate, buildRecordId]
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
        deleteMutate({ recordId: buildRecordId(instanceId) })
      }
    },
    [confirmDelete, resourceLabel, deleteMutate, buildRecordId]
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
        const result = await bulkDeleteMutateAsync({
          recordIds: rows.map((r) => buildRecordId(r.id)),
        })

        // Optimistic removal from store
        const failedIds = new Set(
          result.errors.map((e) => parseRecordId(e.recordId).entityInstanceId)
        )
        for (const row of rows) {
          if (!failedIds.has(row.id) && entityDefinitionId) {
            useRecordStore.getState().removeRecord(entityDefinitionId, row.id)
          }
        }
        onRefetch?.()

        if (result.errors.length > 0) {
          toastError({
            title: 'Some records could not be deleted',
            description: `${result.count} deleted, ${result.errors.length} failed.`,
          })
        }
      }
    },
    [
      confirmDelete,
      resourceLabel,
      resourcePlural,
      bulkDeleteMutateAsync,
      buildRecordId,
      entityDefinitionId,
      onRefetch,
    ]
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
        await bulkArchiveMutateAsync({
          recordIds: rows.map((r) => buildRecordId(r.id)),
        })
      }
    },
    [confirmArchive, resourceLabel, resourcePlural, bulkArchiveMutateAsync, buildRecordId]
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
        const recordId = buildRecordId(instanceId)
        // Money MI1 §G.5: invoices have their own lifecycle delete (payments guard +
        // source-line unstamp) — the generic `record.delete` would bypass both.
        if (entityType === 'invoice') {
          deleteInvoiceMutate({ invoiceRecordId: recordId })
        } else {
          deleteMutate({ recordId })
        }
        onDrawerClose?.()
      }
    },
    [
      confirmDelete,
      resourceLabel,
      onDrawerClose,
      buildRecordId,
      deleteMutate,
      deleteInvoiceMutate,
      entityType,
    ]
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
