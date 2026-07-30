// apps/web/src/components/resources/hooks/index.ts

export { useRunAiBulkGenerate } from './run-ai-bulk-generate'
// Actor hooks
export {
  useActor,
  useActorInitialized,
  useActorLoading,
  useActors,
  useAvailableActors,
  useGroupMembers,
} from './use-actor'
export { type FieldInfo, useAllRecords } from './use-all-records'
// export { useEntityDefinition, useEntityDefinitionById } from './use-entity-definition'
export { useEntityDefinitionMutations } from './use-entity-definition-mutations'
// Entity field values hook
export { useEntityValues } from './use-entity-values'
export {
  useField,
  useFieldByKey,
  useFieldIsDeleted,
  useFieldIsPending,
  useFieldSelectOption,
  useFields,
  useResourceProperty,
  useSystemField,
} from './use-field'
// Field value hooks (extracted from store)
export { useFieldCellState, useFieldValue, useFieldValues } from './use-field-values'
// FILE ref hydration (batched — see file-ref-store)
export { type FileRefDetail, useFileRefs } from './use-file-refs'
export { useIsRecordLoading, useIsRecordPending, useRecord } from './use-record'
// Per-ROW record affordances, from the `_access` stamp (plan v3/03 §5.2)
export type { RecordRowAccess } from './use-record-access'
export { useRecordAccess, useRecordAccessAt, useRecordAccessFor } from './use-record-access'
export { useRecordBatchFetcher } from './use-record-batch-fetcher'
// Record hydration hook
export { useRecordHydration } from './use-record-hydration'
export { useRecordInvalidation } from './use-record-invalidation'
// Record store hooks
export { useRecordList } from './use-record-list'
export { useCanViewRecordResource } from './use-record-resource-gate'
export { useRecords } from './use-records'
export { useRelationship } from './use-relationship'
// Entity ID resolution hooks
export { useResolveEntityDefinitionId } from './use-resolve-entity-id'
export { useResource } from './use-resource'
// Resource access hooks
export { useResourceAccess } from './use-resource-access'
export { useResourceFields } from './use-resource-fields'
export { useResources } from './use-resources'
export { useSaveFieldValue } from './use-save-field-value'
export { useSaveSystemValues } from './use-save-system-values'
export { useSystemValues } from './use-system-values'
export { useViewableResources } from './use-viewable-resources'
