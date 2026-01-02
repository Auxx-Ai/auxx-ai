// apps/web/src/components/resources/hooks/index.ts

export { useAllResources } from './use-all-resources'
export { useResource } from './use-resource'
export { useEntityDefinition, useEntityDefinitionById } from './use-entity-definition'
export { useEntityDefinitionMutations } from './use-entity-definition-mutations'
export { useRelationship } from './use-relationship'
export { useResourceFields } from './use-resource-fields'

// Record store hooks
export { useRecordList } from './use-record-list'
export { useRecord, useIsRecordLoading, useIsRecordPending } from './use-record'
export { useRecordWithFetch } from './use-record-with-fetch'
export { useRecordInvalidation } from './use-record-invalidation'
export { useRecordBatchFetcher } from './use-record-batch-fetcher'
