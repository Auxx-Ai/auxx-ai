// packages/lib/src/resources/crud/index.ts

// Types
export type {
  BulkResult,
  CreateRecordOptions,
  CrudContext,
  CrudResult,
  CrudResultFailure,
  CrudResultSuccess,
  FindByFieldOptions,
  TransformedData,
  UpdateRecordOptions,
} from './types'
export type { CrudOptions } from './unified-handler'
// Main handler
export { UnifiedCrudHandler } from './unified-handler'
// Mutation utilities (for advanced use cases)
export type { CreateEntityResult, MutationContext } from './unified-handler-mutations'
export type {
  ListAllFieldInfo,
  ListAllInput,
  ListAllItem,
  ListAllResult,
  ListFilteredInput,
  ListFilteredResult,
} from './unified-handler-queries'
// Query utilities
export {
  extractRequiredRelatedEntities,
  getTableSchema,
  isSystemResource,
  listAll,
  queryEntityInstanceIds,
  querySystemResourceIds,
  resolveEntityId,
} from './unified-handler-queries'

// Handlers
// export { getHandler, contactHandler, ticketHandler, entityHandler } from './handlers'
// export type { ResourceHandler } from './handlers'

// Utilities
export {
  type FieldChange,
  fromDbResult,
  hasChanges,
  isNotFound,
  parseTags,
  setCustomFields,
  trackChanges,
} from './utils'
