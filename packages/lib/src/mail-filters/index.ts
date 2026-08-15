// packages/lib/src/mail-filters/index.ts
// Mail-filters domain barrel (plans/mail-filter/02-mail-filters-plan.md §2).
// Explicit named exports only — see CLAUDE.md's "Module Exports" convention.

// Action executor (§4.3)
export {
  captureUndoState,
  executeMailFilterAction,
  isRetroactiveSkippedAction,
  type MailFilterActionContext,
  type MailFilterActionResult,
  type MailFilterInbox,
  RETROACTIVE_SKIP_REASON,
  RETROACTIVE_SKIPPED_ACTION_TYPES,
} from './actions'
// Org cache
export {
  dehydrateMailFilter,
  getEnabledMailFiltersForInbox,
  orgHasEnabledMailFilters,
} from './cache'
// Client-safe catalog + summaries (also importable as `@auxx/lib/mail-filters/client`)
export {
  describeMailFilter,
  describeMailFilterAction,
  getMailFilterField,
  getMailFilterFields,
  MAIL_FILTER_ACTION_LABELS,
  MAIL_FILTER_EXCLUDED_FIELD_IDS,
  type MailFilterNameResolver,
} from './client'
// The engine (§3 claim protocol, §4.4 containment, §4.5 ordering)
export {
  type FireMailFiltersInput,
  type FireMailFiltersResult,
  fireMailFilters,
} from './engine'
// The single evaluator (§4.2, invariant 5)
export { buildFilterPredicate, FILTER_PREDICATE_CHUNK_SIZE, matchFilters } from './evaluate'
// Plan limits (§5.2)
export { countBillableMailFilters, countPersonalMailFilters } from './limits'
// Writes
export {
  assertFilterShape,
  createMailFilter,
  deleteMailFilter,
  reorderMailFilters,
  setMailFilterEnabled,
  touchLastFiredAtMany,
  type UpdateMailFilterInput,
  updateMailFilter,
} from './mutations'
// Authoring-time value normalisation (plan 09 §7)
export { normalizePhoneConditionValues } from './normalize-conditions'
// Reads
export {
  getMailFilterById,
  getMailFilterRunById,
  type ListMailFiltersOptions,
  listMailFilterRuns,
  listMailFilterRunsForThread,
  listMailFilters,
} from './queries'
// Reach: preview count, retroactive apply, post-connect prompt (§7, D18)
export {
  applyRetroactively,
  assertBackfillable,
  findPendingRetroactivePrompt,
  loadBackfillableFilter,
  MAIL_FILTER_RETROACTIVE_JOB_NAME,
  type MailFilterRetroactiveJobData,
  mailFilterRetroactiveApplyJob,
  type PendingRetroactivePrompt,
  PREVIEW_MATCH_COUNT_CAP,
  PROMPT_THREAD_COUNT_CAP,
  type PreviewMatchCountResult,
  previewMatchCount,
  RETROACTIVE_MAX_THREADS,
  RETROACTIVE_PAGE_SIZE,
  type RetroactiveApplyReport,
  type RetroactiveTermination,
} from './retroactive'
// Run retention (bounds Undo)
export { MAIL_FILTER_RUN_RETENTION_JOB_NAME, mailFilterRunRetentionJob } from './run-retention-job'
// Run claim protocol (§3, invariant 4)
export {
  type ClaimMailFilterRunInput,
  type CompleteMailFilterRunInput,
  claimMailFilterRun,
  completeMailFilterRun,
  markMailFilterRunUndone,
} from './runs'
// Seeded suggested starter filters (§9 phase 5, `templateKey`)
export {
  SUGGESTED_MAIL_FILTER_TEMPLATES,
  type SuggestedMailFilterTemplate,
  seedSuggestedMailFilters,
} from './seed-suggested-filters'
// Types
export {
  ACTION_REQUIRING_AUTOMATION_KEY,
  type CachedMailFilter,
  MAIL_FILTER_ACTION_TYPES,
  MAIL_FILTER_STATUSES,
  MAX_PERSONAL_MAIL_FILTERS,
  type MailFilterAction,
  type MailFilterActionOutcome,
  type MailFilterInput,
  type MailFilterRecord,
  type MailFilterRow,
  type MailFilterRunRecord,
  type MailFilterRunRow,
  type MailFilterRunSource,
  type MailFilterRunStatus,
  type MailFilterUndoState,
  toMailFilterRow,
  toMailFilterRunRow,
} from './types'
// Undo one firing (D9)
export {
  type MailFilterUndoField,
  type UndoMailFilterRunResult,
  undoMailFilterRun,
} from './undo'
