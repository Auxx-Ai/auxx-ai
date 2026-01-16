// apps/web/src/components/dynamic-table/utils/debug-stores.ts

import { useDynamicTableStore } from '../stores/dynamic-table-store'

/**
 * Debug utility to inspect the unified table store.
 * Call this from browser console or add temporary logging.
 *
 * Usage in browser console:
 * ```
 * import { debugTableStores } from '~/components/dynamic-table/utils/debug-stores'
 * debugTableStores('your-table-id')
 * ```
 */
export function debugTableStores(tableId?: string) {
  const store = useDynamicTableStore.getState()

  console.group('🔍 Dynamic Table Store Debug')

  // View Slice
  console.group('📋 View Slice (metadata)')
  console.log('Initialized:', store.initialized)
  console.log('Error:', store.error)
  if (tableId) {
    const views = store.viewsByTableId[tableId] || []
    const activeViewId = store.activeViewIds[tableId]
    console.log(`Views for table "${tableId}":`, views.length, 'views')
    console.log('Active view ID:', activeViewId)
    console.log('Views:', views)
  } else {
    console.log('All tables:', Object.keys(store.viewsByTableId))
  }
  console.groupEnd()

  // UI Slice
  console.group('🎨 UI Slice (UI config)')
  console.log('View configs:', Object.keys(store.viewConfigs).length, 'views')
  console.log('Pending configs:', Object.keys(store.pendingConfigs).length, 'views')
  console.log('Dirty view IDs:', Array.from(store.dirtyViewIds))
  if (tableId) {
    const sessionConfig = store.sessionConfigs[tableId]
    console.log(`Session config for "${tableId}":`, sessionConfig)
  }
  console.log('All view configs:', store.viewConfigs)
  console.groupEnd()

  // Filter Slice
  console.group('🔍 Filter Slice (filters)')
  console.log('View filters:', Object.keys(store.viewFilters).length, 'views')
  console.log('Session filters:', Object.keys(store.sessionFilters).length, 'tables')
  if (tableId) {
    const sessionFilters = store.sessionFilters[tableId] || []
    console.log(`Session filters for "${tableId}":`, sessionFilters)
  }
  console.log('All view filters:', store.viewFilters)
  console.log('All session filters:', store.sessionFilters)
  console.groupEnd()

  console.groupEnd()

  // Return summary object for programmatic access
  return {
    viewSlice: {
      initialized: store.initialized,
      viewCount: tableId
        ? (store.viewsByTableId[tableId] || []).length
        : Object.values(store.viewsByTableId).flat().length,
      activeViewId: tableId ? store.activeViewIds[tableId] : null,
    },
    uiSlice: {
      configCount: Object.keys(store.viewConfigs).length,
      pendingCount: Object.keys(store.pendingConfigs).length,
      dirtyCount: store.dirtyViewIds.size,
    },
    filterSlice: {
      viewFilterCount: Object.keys(store.viewFilters).length,
      sessionFilterCount: Object.keys(store.sessionFilters).length,
    },
  }
}

/**
 * Verify that the store is properly initialized for a specific view.
 * Returns true if all data is present for the view.
 */
export function verifyStoreSync(viewId: string): boolean {
  const store = useDynamicTableStore.getState()

  // Find the view
  const allViews = Object.values(store.viewsByTableId).flat()
  const view = allViews.find((v) => v.id === viewId)

  if (!view) {
    console.error(`❌ View ${viewId} not found in store`)
    return false
  }

  // Check if UI config exists
  const hasUIConfig = !!store.viewConfigs[viewId]
  if (!hasUIConfig) {
    console.error(`❌ View ${viewId} missing UI config`)
    return false
  }

  // Check if filters exist (can be empty array)
  const hasFilters = viewId in store.viewFilters
  if (!hasFilters) {
    console.error(`❌ View ${viewId} missing filters`)
    return false
  }

  console.log(`✅ View ${viewId} is properly synced in store`)
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
