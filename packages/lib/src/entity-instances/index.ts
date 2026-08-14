// packages/lib/src/entity-instances/index.ts

// Note: EntityInstanceService has been deprecated and replaced by UnifiedCrudHandler
// Import from '@auxx/lib/resources/crud' instead

export {
  resolveThreadLinkedEntityIds,
  touchActivityForThreadLinks,
  touchEntityActivity,
  touchEntityInteraction,
  touchInteractionForThreadLinks,
} from './activity'
export type {
  ContactMetadata,
  EntityMetadata,
  MetadataByEntityType,
  PartMetadata,
  TicketMetadata,
} from './metadata-types'
