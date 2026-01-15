// apps/web/src/components/dynamic-table/hooks/use-view-mutations.ts

import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { useViewStore } from '../stores/view-store'
import type { TableView } from '../types'

/**
 * Hook that provides all view-related mutations with store synchronization
 * @param tableId - The table ID for the mutations
 * @param onViewSelect - Optional callback when a view needs to be selected (e.g., after delete)
 */
export function useViewMutations(tableId: string, onViewSelect?: (viewId: string | null) => void) {
  const utils = api.useUtils()

  // Store actions for syncing
  const addViewToStore = useViewStore((state) => state.addView)
  const removeViewFromStore = useViewStore((state) => state.removeView)
  const updateViewMeta = useViewStore((state) => state.updateViewMeta)
  const setTableViews = useViewStore((state) => state.setTableViews)

  /** Create a new view */
  const createView = api.tableView.create.useMutation({
    onSuccess: (newView) => {
      toastSuccess({ title: 'View created successfully' })
      // Add to store immediately
      addViewToStore(newView as TableView)
      // Also invalidate for backward compatibility
      utils.tableView.list.invalidate({ tableId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to create view', description: error.message })
    },
  })

  /** Update an existing view */
  const updateView = api.tableView.update.useMutation({
    onSuccess: (updatedView) => {
      toastSuccess({ title: 'View updated successfully' })
      // Update store with new metadata
      updateViewMeta(updatedView.id, { name: updatedView.name })
      utils.tableView.list.invalidate({ tableId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to update view', description: error.message })
    },
  })

  /** Delete a view */
  const deleteView = api.tableView.delete.useMutation({
    onSuccess: (_data, variables) => {
      toastSuccess({ title: 'View deleted successfully' })
      // Remove from store immediately
      removeViewFromStore(variables.id, tableId)
      utils.tableView.list.invalidate({ tableId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete view', description: error.message })
    },
  })

  /** Duplicate a view */
  const duplicateView = api.tableView.duplicate.useMutation({
    onSuccess: (newView) => {
      toastSuccess({ title: 'View duplicated successfully' })
      // Add duplicated view to store
      addViewToStore(newView as TableView)
      utils.tableView.list.invalidate({ tableId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to duplicate view', description: error.message })
    },
  })

  /** Set a view as default */
  const setDefaultView = api.tableView.setDefault.useMutation({
    onSuccess: async () => {
      // Refetch to get updated isDefault flags and update store
      const result = await utils.tableView.list.fetch({ tableId })
      if (result) {
        setTableViews(tableId, result as TableView[])
      }
    },
    onError: (error) => {
      toastError({ title: 'Failed to set default view', description: error.message })
    },
  })

  return {
    createView,
    updateView,
    deleteView,
    duplicateView,
    setDefaultView,
  }
}
