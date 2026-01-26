// apps/web/src/components/resources/hooks/index.ts

export { useResources } from './use-resources'
export { useResource } from './use-resource'
// export { useEntityDefinition, useEntityDefinitionById } from './use-entity-definition'
export { useEntityDefinitionMutations } from './use-entity-definition-mutations'
export { useRelationship } from './use-relationship'
export { useResourceFields } from './use-resource-fields'
export {
  useField,
  useFields,
  useFieldIsPending,
  useFieldIsDeleted,
  useResourceProperty,
  useFieldSelectOption,
} from './use-field'

// Record store hooks
export { useRecordList } from './use-record-list'
export { useRecord, useIsRecordLoading, useIsRecordPending } from './use-record'
export { useRecords } from './use-records'
export { useRecordInvalidation } from './use-record-invalidation'
export { useRecordBatchFetcher } from './use-record-batch-fetcher'

// Entity field values hook
export { useEntityValues } from './use-entity-values'

// Field value hooks (extracted from store)
export { useFieldValue, useResourceFieldValues } from './use-field-values'

// Record hydration hook
export { useRecordHydration } from './use-record-hydration'

// Actor hooks
export {
  useActor,
  useActors,
  useAvailableActors,
  useGroupMembers,
  useActorLoading,
  useActorInitialized,
} from './use-actor'

// Resource access hooks
export { useResourceAccess } from './use-resource-access'
