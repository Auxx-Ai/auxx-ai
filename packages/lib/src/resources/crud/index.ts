// packages/lib/src/resources/crud/index.ts

// Main services
export { UnifiedCrudHandler } from './unified-handler'
export type { CrudOptions } from './unified-handler'

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
