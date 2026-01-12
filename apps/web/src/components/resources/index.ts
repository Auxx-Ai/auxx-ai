// apps/web/src/components/resources/index.ts

// Provider
export { ResourceProvider, useResourceProvider, clearResourceCaches } from './providers/resource-provider'

// Hooks
export {
  useAllResources,
  useResource,
  useEntityDefinition,
  useEntityDefinitionById,
  useRelationship,
  useResourceFields,
  // Record store hooks
  useRecordList,
  useRecord,
  useIsRecordLoading,
  useIsRecordPending,
  useRecordInvalidation,
  useRecordHydration,
  // Entity field values
  useEntityValues,
} from './hooks'

// Store utilities (for advanced use cases)
export {
  buildRelationshipKey,
  parseRelationshipKey,
  getRelationshipStoreState,
  // Record store utilities
  useRecordStore,
  getRecordStoreState,
  createListKey,
  isListStale,
  EMPTY_FILTERS,
  EMPTY_SORTING,
  type RecordMeta,
} from './store'
