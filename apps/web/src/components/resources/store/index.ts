// apps/web/src/components/resources/store/index.ts

export {
  useRelationshipStore,
  getRelationshipStoreState,
  useHydratedItems,
  useIsLoadingRelationships,
  toResourceId,
  parseResourceId,
  type RelationshipStoreState,
  type ResourceId,
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
