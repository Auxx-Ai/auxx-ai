// packages/lib/src/sequences/index.ts
// Sequences domain barrel (Sequences plan §3.3/§3.4, Phase 2). Explicit named
// exports only — see CLAUDE.md's "Module Exports" convention.

export type { SequenceAccessContext } from './access'
// Access
export { checkSequenceAccess, grantSequenceCreatorAccess } from './access'
export type { AnchorStepConfig, AnchorSubjectKind, SubjectAnchorDate } from './anchor'
// Anchored-step date math (client-notifications plan §4.2) — pure math + the live subject-date
// read, shared by the wait node, the send node's live-anchor guard, `reanchorSequenceRuns`, and
// (re-exported here so callers only need `@auxx/lib/sequences`) enrollment/verify-script math
// assertions.
export { computeAnchorTarget, isPastAnchor, resolveSubjectAnchorDate } from './anchor'
export type { SequenceSubjectKind, SequenceTriggerType } from './client'
// Client-safe constants
export {
  deriveSubjectKindFromTrigger,
  SEQUENCE_ANCHOR_LABELS,
  SEQUENCE_ANCHORABLE_SUBJECT_KINDS,
  SEQUENCE_ENROLL_MAX_RECIPIENTS,
  SEQUENCE_TRIGGER_LABELS,
  SEQUENCE_TRIGGER_TYPES,
} from './client'
export type { UpdateSequenceInput } from './crud'
// CRUD
export {
  createSequence,
  deleteSequence,
  getSequence,
  listSequences,
  updateSequence,
} from './crud'
// Enroll
export { enrollRecipients } from './enroll'
// Enrollment filter (client-notifications plan §4.1 decision #17)
export { evaluateEnrollmentFilter } from './enrollment-filter'
// Event-trigger field-change hooks (registered in field-hooks/register-hooks.ts)
export {
  enrollInvoiceReminderOnSent,
  enrollJobFollowUpOnCompletion,
  reanchorInvoiceOnDueDateChange,
} from './field-change-hooks'
// Event-trigger hook bodies (client-notifications plan §4.3/§4.10)
export {
  enrollInvoiceSentSequences,
  enrollVisitEnRouteSequences,
  enrollVisitScheduledSequences,
  enrollWorkOrderCompletedSequences,
  exitRunsForDeadVisitSubjects,
  exitVisitSequenceRuns,
  onVisitCompleted,
} from './hooks'
export type { PublishSequenceInput } from './publish'
// Publish
export { buildSequenceGraph, publishSequence } from './publish'
export type { ReanchorSequenceRunsResult, ReanchorSubjectKind } from './reanchor'
// Re-anchor — belt-and-suspenders hook for `scheduleVisit`/invoice due-date edits (§4.2)
export { reanchorSequenceRuns } from './reanchor'
export type { ListRunsInput, ManualExitRunInput } from './runs'
// Runs
export { listRuns, manualExitRun } from './runs'
export type { ExitActiveRunsResult, ExitSequenceRunParams } from './runtime'
// Runtime — shared exit path + unsubscribe URL builder (owned by the parallel
// sequences-runtime workstream; re-exported here so callers only need
// `@auxx/lib/sequences`).
export { buildSequenceUnsubscribeUrl, exitActiveRunsForSequence, exitSequenceRun } from './runtime'
// Seed templates (client-notifications plan §4.6) — new-org path (organization-seeder.ts) +
// existing-org backfill (scripts/backfill-client-notification-sequences.ts)
export { SEQUENCE_SEED_TEMPLATES, seedClientNotificationSequences } from './seed-templates'
export type { GetSequenceStatsInput } from './stats'
// Stats
export { getSequenceStats } from './stats'
export type { UpdateStepInput } from './steps'
// Steps
export { createStep, deleteStep, reorderStep, updateStep } from './steps'
export type { SubjectContext, SubjectGuardOutcome } from './subject'
// Subject-scoped send-node guards (client-notifications plan §4.4 (1)+(2)+(3)) — re-exported so
// callers (the verify script's direct guard/recipient assertions) don't need the deep
// `./subject` path, which isn't its own package.json export subpath.
export {
  evaluateSubjectGuards,
  resolveSubjectContext,
  resolveSubjectRecipientEmail,
} from './subject'
export type {
  EnrollSubjectInSequenceInput,
  EnrollSubjectOutcome,
  EnrollSubjectSource,
} from './subject-enroll'
// Subject enrollment internals (client-notifications plan §4.3) — shared by the event-trigger
// hooks + the hourly enrollment sweep
export { enrollSubjectInSequence } from './subject-enroll'
export type { UpsertSuppressionInput } from './suppression'
// Suppression
export { isSuppressed, normalizeEmail, upsertSuppression } from './suppression'
// Hourly enrollment sweep (client-notifications plan §4.3, decision #13)
export { computeSweepLookaheadDays, runSequenceEnrollmentSweep } from './sweep'
// Per-org enabled-trigger lookup (client-notifications plan §4.3/§7 open question #3)
export { getEnabledSequencesForTrigger } from './triggers'
// Types
export type {
  CreateSequenceInput,
  CreateStepInput,
  EnrollRecipientResult,
  EnrollRecipientsInput,
  ReorderStepInput,
  SequenceEntity,
  SequenceInsert,
  SequenceRunEntity,
  SequenceRunInsert,
  SequenceRunListItem,
  SequenceRunUpdate,
  SequenceStats,
  SequenceStepEntity,
  SequenceStepInsert,
  SequenceStepUpdate,
  SequenceSuppressionEntity,
  SequenceSuppressionInsert,
  SequenceUpdate,
  UnsubscribePayload,
  UpdateSequenceFields,
  UpdateStepFields,
} from './types'
// Unsubscribe
export { getUnsubscribePayload, unsubscribeByToken } from './unsubscribe'
