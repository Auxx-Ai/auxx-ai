// apps/web/src/components/resources/index.ts

// Provider
export {
  ResourceProvider,
  useResourceProvider,
  clearResourceCaches,
} from './providers/resource-provider'

// Hooks
export {
  useResources,
  useResource,
  useRelationship,
  useResourceFields,
  // Record store hooks
  useRecordList,
  useRecord,
  useRecords,
  useIsRecordLoading,
  useIsRecordPending,
  useRecordInvalidation,
  useRecordHydration,
  // Entity field values
  useEntityValues,
} from './hooks'

// Store utilities (for advanced use cases)
export {
  toResourceId,
  parseResourceId,
  getRelationshipStoreState,
  // Record store utilities
  useRecordStore,
  getRecordStoreState,
  createListKey,
  isListStale,
  EMPTY_FILTERS,
  EMPTY_SORTING,
  type RecordMeta,
  type ResourceId,
} from './store'

// Utilities
export { getResourceLink, useResourceLink, type GetResourceLinkOptions } from './utils'
