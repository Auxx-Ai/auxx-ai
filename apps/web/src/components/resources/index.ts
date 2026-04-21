// apps/web/src/components/resources/index.ts

// Hooks
export {
  // Types
  type FieldInfo,
  // Entity field values
  useEntityValues,
  useField,
  useFieldByKey,
  useFields,
  useIsRecordLoading,
  useIsRecordPending,
  useRecord,
  useRecordHydration,
  useRecordInvalidation,
  // Record store hooks
  useRecordList,
  useRecords,
  useRelationship,
  useResource,
  useResourceFields,
  useResourceProperty,
  useResources,
} from './hooks'
// Provider
export { clearResourceCaches, ResourceProvider } from './providers/resource-provider'

// Store utilities (for advanced use cases)
export {
  createListKey,
  EMPTY_FILTERS,
  EMPTY_SORTING,
  getRecordStoreState,
  // Relationship store
  getRelationshipStoreState,
  getResourceStoreState,
  isListStale,
  parseRecordId,
  type RecordId,
  type RecordMeta,
  toRecordId,
  // Record store utilities
  useRecordStore,
  // Resource store
  useResourceStore,
} from './store'

// Utilities
export { type GetRecordLinkOptions, getRecordLink, useRecordLink } from './utils'
