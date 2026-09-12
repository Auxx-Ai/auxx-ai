// packages/lib/src/money/batch-posting/index.ts

/**
 * The shared frame behind the bulk posters
 * (`plans/accounting/tasks/25-batch-posting-and-credit-memos.md` §5).
 *
 * Explicit named exports only (`docs/lib-module-guide.md` §5).
 */

export {
  BATCH_POSTING_EXCLUSION_REASONS,
  BATCH_POSTING_GROUPINGS,
  type BatchPostingExclusionReason,
  type BatchPostingGrouping,
} from './client'
