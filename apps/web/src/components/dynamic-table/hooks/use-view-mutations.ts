// apps/web/src/components/dynamic-table/hooks/use-view-mutations.ts

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { useDynamicTableStore } from '../stores/dynamic-table-store'
import type { TableView } from '../types'

/**
 * Hook that provides all view-related mutations with store synchronization.
 * Uses the unified DynamicTableStore - all slices are updated together.
 *
 * @param tableId - The table ID for the mutations
 * @param onViewSelect - Optional callback when a view needs to be selected (e.g., after delete)
 */
export function useViewMutations(tableId: string, onViewSelect?: (viewId: string | null) => void) {
  const utils = api.useUtils()

  // Store actions for syncing (from unified store)
  const addViewToStore = useDynamicTableStore((state) => state.addView)
  const removeViewFromStore = useDynamicTableStore((state) => state.removeView)
  const updateViewMeta = useDynamicTableStore((state) => state.updateViewMeta)
  const setTableViews = useDynamicTableStore((state) => state.setTableViews)

  /** Create a new view */
  const createView = api.tableView.create.useMutation({
    onSuccess: (newView) => {
      toastSuccess({ title: 'View created successfully' })

      // Add to unified store - this initializes all slices at once
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

      // Add to unified store - this initializes all slices at once
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
        const views = result as TableView[]

        // Update unified store - this updates all slices at once
        setTableViews(tableId, views)
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
