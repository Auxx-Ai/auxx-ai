// apps/web/src/components/resources/store/index.ts

export {
  useRelationshipStore,
  getRelationshipStoreState,
  useHydratedItems,
  useIsLoadingRelationships,
  buildRelationshipKey,
  parseRelationshipKey,
  type RelationshipStoreState,
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
