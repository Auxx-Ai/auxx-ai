// packages/lib/src/entity-instances/index.ts

// Note: EntityInstanceService has been deprecated and replaced by UnifiedCrudHandler
// Import from '@auxx/lib/resources/crud' instead

export {
  resolveThreadLinkedEntityIds,
  touchActivityForThreadLinks,
  touchEntityActivity,
  touchEntityInteraction,
  touchInteractionForMessage,
} from './activity'
export {
  type BatchUpdateDisplayValuesInput,
  batchUpdateDisplayValues,
  type ClearDisplayValuesInput,
  clearDisplayValues,
} from './batch-update-display-values'
export {
  type CreateEntityInstanceParams,
  createEntityInstance,
} from './create-entity-instance'
export {
  type DeleteEntityInstanceParams,
  type DeleteEntityInstancesParams,
  deleteEntityInstance,
  deleteEntityInstances,
} from './delete-entity-instance'
export type { EntityInstanceError } from './errors'
export {
  type EntityInstanceRow,
  type GetEntityInstanceParams,
  getEntityInstance,
  getEntityInstanceRow,
} from './get-entity-instance'
export { type ListEntityInstancesParams, listEntityInstances } from './list-entity-instances'
export type {
  ContactMetadata,
  EntityMetadata,
  MetadataByEntityType,
  PartMetadata,
  TicketMetadata,
} from './metadata-types'
export {
  type ArchiveEntityInstancesParams,
  archiveEntityInstances,
  type UpdateEntityInstanceParams,
  updateEntityInstance,
} from './update-entity-instance'
