// packages/lib/src/resources/merge/index.ts

/**
 * Server-side merge functionality.
 * Includes database operations and services.
 */

// Re-export client utilities for convenience
export { mergeFieldValue } from './merge'
export { EntityMergeService } from './merge-service'
export type {
  MergeEntitiesInput,
  MergeEntitiesResult,
  MergeFieldInput,
  MergeFieldResult,
} from './types'
