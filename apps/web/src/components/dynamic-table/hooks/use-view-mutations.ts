// apps/web/src/components/dynamic-table/hooks/use-view-mutations.ts

import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { useViewStore } from '../stores/view-store'
import { useTableUIStore } from '../stores/table-ui-store'
import { useFilterStore } from '../stores/filter-store'
import { extractUIConfig } from '../utils/extract-ui-config'
import type { TableView } from '../types'

/**
 * Hook that provides all view-related mutations with store synchronization.
 * Syncs changes across all stores: view-store, table-ui-store, and filter-store.
 *
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

      // 1. Add to view-store (metadata)
      addViewToStore(newView as TableView)

      // 2. Initialize table-ui-store (UI config)
      const uiConfig = extractUIConfig(newView.config)
      useTableUIStore.getState().setViewConfig(newView.id, uiConfig)

      // 3. Initialize filter-store (filters)
      const filters = newView.config.filters ?? []
      useFilterStore.getState().setViewFilters(newView.id, filters)

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

      // 1. Add to view-store (metadata)
      addViewToStore(newView as TableView)

      // 2. Initialize table-ui-store (UI config)
      const uiConfig = extractUIConfig(newView.config)
      useTableUIStore.getState().setViewConfig(newView.id, uiConfig)

      // 3. Initialize filter-store (filters)
      const filters = newView.config.filters ?? []
      useFilterStore.getState().setViewFilters(newView.id, filters)

      utils.tableView.list.invalidate({ tableId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to duplicate view', description: error.message })
    },
  })

  /** Set a view as default */
  const setDefaultView = api.tableView.setDefault.useMutation({
    onSuccess: async () => {
      // Refetch to get updated isDefault flags and update all stores
      const result = await utils.tableView.list.fetch({ tableId })
      if (result) {
        const views = result as TableView[]

        // 1. Update view-store (metadata)
        setTableViews(tableId, views)

        // 2. Update table-ui-store (UI config)
        const tableUIStore = useTableUIStore.getState()
        for (const view of views) {
          const uiConfig = extractUIConfig(view.config)
          tableUIStore.setViewConfig(view.id, uiConfig)
        }

        // 3. Update filter-store (filters)
        const filterStore = useFilterStore.getState()
        for (const view of views) {
          const filters = view.config.filters ?? []
          filterStore.setViewFilters(view.id, filters)
        }
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
