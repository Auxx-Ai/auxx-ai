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
export type {
  CrudOptions,
  LookupByFieldResult,
  LookupCandidate,
  LookupMatch,
} from './unified-handler'
// Main handler
export { UnifiedCrudHandler } from './unified-handler'
// Mutation utilities (for advanced use cases)
export type { CreateEntityResult, MutationContext } from './unified-handler-mutations'
export type {
  CountFilteredResult,
  DroppedFilterNotice,
  ListAllFieldInfo,
  ListAllInput,
  ListAllItem,
  ListAllResult,
  ListFilteredInput,
  ListFilteredResult,
} from './unified-handler-queries'
// Query utilities
export {
  countEntityInstances,
  countSystemResource,
  extractRequiredRelatedEntities,
  getTableSchema,
  isSystemResource,
  listAll,
  MAX_REPORTED_DROPPED_CONDITIONS,
  queryEntityInstanceIdsPaged,
  querySystemResourceIdsPaged,
  resolveEntityId,
  resolveEntityIdFromCache,
} from './unified-handler-queries'

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

// Write session (plan 03 §4/§4b — Phase 3 slice a)
export {
  interactiveSession,
  seedSession,
  sessionLane,
  type WriteOrigin,
  type WriteSession,
} from './write-origin'
export { getAmbientWriteSession, runWithWriteSession } from './write-session-als'
