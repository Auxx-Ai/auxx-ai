// packages/lib/src/mail-suggestions/index.ts
// Mined mail-suggestions domain barrel (plans/mail-filter/03-suggestions-plan.md).
// Explicit named exports only — see CLAUDE.md's "Module Exports" convention.

// Client-safe helpers (also importable as `@auxx/lib/mail-suggestions/client`)
export {
  DOMAIN_SUBJECT_PREFIX,
  describeMailSuggestion,
  describeSubjectKey,
  LIST_SUBJECT_PREFIX,
  MAIL_SUGGESTION_KIND_LABELS,
  parseSubjectKey,
  resolveUnsubscribeMethod,
  toSubjectKey,
} from './client'
// The mining layer (§5): the grouped query, the thresholds, the suppression rules
export {
  ALREADY_FILTERED_RATE,
  type BuildDraftsParams,
  buildInboxGroupQuery,
  buildMailSuggestionDrafts,
  CONSISTENCY_THRESHOLD,
  historyDaysOf,
  type InboxGroupQueryParams,
  MANUAL_ARCHIVE_RATE_THRESHOLD,
  MAX_SUGGESTIONS_PER_INBOX,
  type MailGroupStats,
  MIN_HISTORY_DAYS,
  MIN_MESSAGES,
  MIN_THREADS,
  type MineableInbox,
  type MineInboxResult,
  type MineOrganizationResult,
  mineInboxSuggestions,
  mineOrganizationSuggestions,
  queryInboxGroups,
  resolveProposedConditions,
  SUGGESTION_WINDOW_DAYS,
  toMailGroupStats,
  UNREAD_RATE_THRESHOLD,
} from './mine'
// Writes
export {
  dismissMailSuggestion,
  markMailSuggestionAccepted,
  pruneStaleMailSuggestions,
  upsertMailSuggestion,
  upsertMailSuggestions,
} from './mutations'
// Reads
export {
  getMailSuggestionById,
  type ListMailSuggestionsOptions,
  listMailSuggestions,
  listSuppressedSubjectKeys,
} from './queries'
// Retention (§5.4) — `new` rows only; dismissed rows are the suppression list
export { SUGGESTION_RETENTION_DAYS, sweepStaleMailSuggestions } from './retention'
// Types
export {
  type MailSuggestionDraft,
  type MailSuggestionEvidence,
  type MailSuggestionKind,
  type MailSuggestionRecord,
  type MailSuggestionRow,
  type MailSuggestionStatus,
  type MailUnsubscribeMeta,
  type MailUnsubscribeMethod,
  toMailSuggestionRow,
} from './types'
