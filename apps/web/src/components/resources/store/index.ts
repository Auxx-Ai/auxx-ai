// apps/web/src/components/resources/store/index.ts

export {
  useRelationshipStore,
  getRelationshipStoreState,
  useHydratedItems,
  useIsLoadingRelationships,
  toRecordId,
  parseRecordId,
  type RelationshipStoreState,
  type RecordId,
} from './relationship-store'

export {
  useRecordStore,
  getRecordStoreState,
  createListKey,
  isListStale,
  EMPTY_FILTERS,
  EMPTY_SORTING,
  type RecordMeta,
} from './record-store'

export { useResourceStore, getResourceStoreState } from './resource-store'
