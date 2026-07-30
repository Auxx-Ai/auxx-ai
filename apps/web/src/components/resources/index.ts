// apps/web/src/components/resources/index.ts

// Hooks
export {
  // Types
  type FieldInfo,
  type FileRefDetail,
  // Per-definition read gate for `recordResource` surfaces (tabs, cards)
  useCanViewRecordResource,
  // Entity field values
  useEntityValues,
  useField,
  useFieldByKey,
  useFields,
  // Batched FILE ref hydration
  useFileRefs,
  useIsRecordLoading,
  useIsRecordPending,
  useRecord,
  // Per-ROW record affordances, from the `_access` stamp (plan v3/03 §5.2)
  useRecordAccess,
  useRecordAccessAt,
  useRecordAccessFor,
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
  useViewableResources,
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
export {
  type GetRecordLinkOptions,
  getRecordLink,
  resourceHasDetailPage,
  useRecordLink,
} from './utils'
