// apps/web/src/components/resources/index.ts

// Provider
export { ResourceProvider, clearResourceCaches } from './providers/resource-provider'

// Hooks
export {
  useResources,
  useResource,
  useResourceProperty,
  useRelationship,
  useResourceFields,
  useField,
  useFields,
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
  toRecordId,
  parseRecordId,
  // Resource store
  useResourceStore,
  getResourceStoreState,
  // Relationship store
  getRelationshipStoreState,
  // Record store utilities
  useRecordStore,
  getRecordStoreState,
  createListKey,
  isListStale,
  EMPTY_FILTERS,
  EMPTY_SORTING,
  type RecordMeta,
  type RecordId,
} from './store'

// Utilities
export { getResourceLink, useResourceLink, type GetResourceLinkOptions } from './utils'
