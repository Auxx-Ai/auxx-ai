// packages/lib/src/resources/crud/index.ts

// Main service
export { ResourceCrudService } from './resource-crud-service'

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
export { getHandler, contactHandler, ticketHandler, entityHandler } from './handlers'
export type { ResourceHandler } from './handlers'

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
