// apps/web/src/components/dynamic-table/utils/debug-stores.ts

import { useViewStore } from '../stores/view-store'
import { useTableUIStore } from '../stores/table-ui-store'
import { useFilterStore } from '../stores/filter-store'

/**
 * Debug utility to inspect all table stores.
 * Call this from browser console or add temporary logging.
 *
 * Usage in browser console:
 * ```
 * import { debugTableStores } from '~/components/dynamic-table/utils/debug-stores'
 * debugTableStores('your-table-id')
 * ```
 */
export function debugTableStores(tableId?: string) {
  const viewStore = useViewStore.getState()
  const tableUIStore = useTableUIStore.getState()
  const filterStore = useFilterStore.getState()

  console.group('🔍 Dynamic Table Store Debug')

  // View Store
  console.group('📋 View Store (metadata)')
  console.log('Initialized:', viewStore.initialized)
  console.log('Error:', viewStore.error)
  if (tableId) {
    const views = viewStore.viewsByTableId[tableId] || []
    const activeViewId = viewStore.activeViewIds[tableId]
    console.log(`Views for table "${tableId}":`, views.length, 'views')
    console.log('Active view ID:', activeViewId)
    console.log('Views:', views)
  } else {
    console.log('All tables:', Object.keys(viewStore.viewsByTableId))
  }
  console.groupEnd()

  // Table UI Store
  console.group('🎨 Table UI Store (UI config)')
  console.log('View configs:', Object.keys(tableUIStore.viewConfigs).length, 'views')
  console.log('Pending configs:', Object.keys(tableUIStore.pendingConfigs).length, 'views')
  console.log('Dirty view IDs:', Array.from(tableUIStore.dirtyViewIds))
  if (tableId) {
    const sessionConfig = tableUIStore.sessionConfigs[tableId]
    console.log(`Session config for "${tableId}":`, sessionConfig)
  }
  console.log('All view configs:', tableUIStore.viewConfigs)
  console.groupEnd()

  // Filter Store
  console.group('🔍 Filter Store (filters)')
  console.log('View filters:', Object.keys(filterStore.viewFilters).length, 'views')
  console.log('Session filters:', Object.keys(filterStore.sessionFilters).length, 'tables')
  if (tableId) {
    const sessionFilters = filterStore.sessionFilters[tableId] || []
    console.log(`Session filters for "${tableId}":`, sessionFilters)
  }
  console.log('All view filters:', filterStore.viewFilters)
  console.log('All session filters:', filterStore.sessionFilters)
  console.groupEnd()

  console.groupEnd()

  // Return summary object for programmatic access
  return {
    viewStore: {
      initialized: viewStore.initialized,
      viewCount: tableId
        ? (viewStore.viewsByTableId[tableId] || []).length
        : Object.values(viewStore.viewsByTableId).flat().length,
      activeViewId: tableId ? viewStore.activeViewIds[tableId] : null,
    },
    tableUIStore: {
      configCount: Object.keys(tableUIStore.viewConfigs).length,
      pendingCount: Object.keys(tableUIStore.pendingConfigs).length,
      dirtyCount: tableUIStore.dirtyViewIds.size,
    },
    filterStore: {
      viewFilterCount: Object.keys(filterStore.viewFilters).length,
      sessionFilterCount: Object.keys(filterStore.sessionFilters).length,
    },
  }
}

/**
 * Verify that stores are properly initialized for a specific view.
 * Returns true if all stores have data for the view.
 */
export function verifyStoreSync(viewId: string): boolean {
  const viewStore = useViewStore.getState()
  const tableUIStore = useTableUIStore.getState()
  const filterStore = useFilterStore.getState()

  // Find the view
  const allViews = Object.values(viewStore.viewsByTableId).flat()
  const view = allViews.find((v) => v.id === viewId)

  if (!view) {
    console.error(`❌ View ${viewId} not found in view-store`)
    return false
  }

  // Check if UI config exists
  const hasUIConfig = !!tableUIStore.viewConfigs[viewId]
  if (!hasUIConfig) {
    console.error(`❌ View ${viewId} missing in table-ui-store`)
    return false
  }

  // Check if filters exist (can be empty array)
  const hasFilters = viewId in filterStore.viewFilters
  if (!hasFilters) {
    console.error(`❌ View ${viewId} missing in filter-store`)
    return false
  }

  console.log(`✅ View ${viewId} is synced across all stores`)
  return true
}

/**
 * Hook to expose debug functions in development.
 * Add this to a dev tools panel or use in browser console.
 */
export function useStoreDebugger() {
  if (typeof window !== 'undefined') {
    // @ts-ignore - exposing for debugging
    window.debugTableStores = debugTableStores
    // @ts-ignore
    window.verifyStoreSync = verifyStoreSync
  }

  return { debugTableStores, verifyStoreSync }
}
