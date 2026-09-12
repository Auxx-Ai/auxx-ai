// packages/lib/src/money/batch-posting/client.ts

/**
 * The client-safe half of the shared batch-posting vocabulary.
 *
 * Everything here re-exports `types.ts`, which imports nothing. The file exists
 * so the browser has one import path to the grouping and exclusion vocabularies
 * the shared dialog renders (`docs/lib-module-guide.md` §7).
 *
 * Deliberately NO `'use client'` directive: server code imports this too, and
 * the directive would turn every export into a client-reference proxy there.
 */

export {
  BATCH_POSTING_EXCLUSION_REASONS,
  BATCH_POSTING_GROUPINGS,
  type BatchPostingExclusionReason,
  type BatchPostingGrouping,
} from './types'
