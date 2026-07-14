// packages/lib/src/sequences/index.ts
// Sequences domain barrel (Sequences plan §3.3/§3.4, Phase 2). Explicit named
// exports only — see CLAUDE.md's "Module Exports" convention.

export type { SequenceAccessContext } from './access'
// Access
export { checkSequenceAccess, grantSequenceCreatorAccess } from './access'
// Client-safe constants
export { SEQUENCE_ENROLL_MAX_RECIPIENTS } from './client'
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
export type { PublishSequenceInput } from './publish'
// Publish
export { buildSequenceGraph, publishSequence } from './publish'
export type { ListRunsInput, ManualExitRunInput } from './runs'
// Runs
export { listRuns, manualExitRun } from './runs'
export type { ExitSequenceRunParams } from './runtime'
// Runtime — shared exit path + unsubscribe URL builder (owned by the parallel
// sequences-runtime workstream; re-exported here so callers only need
// `@auxx/lib/sequences`).
export { buildSequenceUnsubscribeUrl, exitSequenceRun } from './runtime'
export type { GetSequenceStatsInput } from './stats'
// Stats
export { getSequenceStats } from './stats'
export type { UpdateStepInput } from './steps'
// Steps
export { createStep, deleteStep, reorderStep, updateStep } from './steps'
export type { UpsertSuppressionInput } from './suppression'
// Suppression
export { isSuppressed, normalizeEmail, upsertSuppression } from './suppression'
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
