// packages/lib/src/resources/merge/index.ts

/**
 * Server-side merge functionality.
 * Includes database operations and services.
 */

export { EntityMergeService } from './merge-service'
export type { MergeEntitiesInput, MergeEntitiesResult } from './types'

// Re-export client utilities for convenience
export { mergeFieldValue } from './merge'
export type { MergeFieldInput, MergeFieldResult } from './types'
