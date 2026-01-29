// packages/lib/src/resources/crud/index.ts

// Main handler
export { UnifiedCrudHandler } from './unified-handler'
export type { CrudOptions } from './unified-handler'

// Query utilities
export {
  extractRequiredRelatedEntities,
  queryEntityInstanceIds,
  querySystemResourceIds,
  getTableSchema,
  isSystemResource,
  resolveEntityId,
  listAll,
} from './unified-handler-queries'
export type {
  ListFilteredInput,
  ListFilteredResult,
  ListAllInput,
  ListAllItem,
  ListAllResult,
} from './unified-handler-queries'

// Mutation utilities (for advanced use cases)
export type { MutationContext, CreateEntityResult } from './unified-handler-mutations'

// Types
export {
  type CrudResult,
  type CrudResultSuccess,
  type CrudResultFailure,
  type CrudContext,
  type TransformedData,
  type BulkResult,
  type CreateRecordOptions,
  type UpdateRecordOptions,
  type FindByFieldOptions,
} from './types'

// Handlers
// export { getHandler, contactHandler, ticketHandler, entityHandler } from './handlers'
// export type { ResourceHandler } from './handlers'

// Utilities
export {
  trackChanges,
  hasChanges,
  type FieldChange,
  setCustomFields,
  fromDbResult,
  isNotFound,
  parseTags,
} from './utils'
