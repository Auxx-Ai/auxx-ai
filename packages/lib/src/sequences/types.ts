// packages/lib/src/sequences/types.ts
// Shared application-facing types for the sequences domain (Sequences plan
// §3.3/§3.4, Phase 2). DB row shapes come straight from
// `packages/database/src/db/schema/sequence.ts`'s inferred types; this file
// only adds the request/response shapes the CRUD/enroll/publish/stats
// functions in this module speak.

import type { SequenceTriggerType } from '@auxx/database'
import type { ConditionGroup } from '../conditions/types'
import type { SequenceExitReason } from './client'

export type {
  CreateSequenceInput as SequenceInsert,
  CreateSequenceRunInput as SequenceRunInsert,
  CreateSequenceStepInput as SequenceStepInsert,
  CreateSequenceSuppressionInput as SequenceSuppressionInsert,
  SequenceEntity,
  SequenceRunEntity,
  SequenceStepEntity,
  SequenceSuppressionEntity,
  SequenceTriggerType,
  UpdateSequenceInput as SequenceUpdate,
  UpdateSequenceRunInput as SequenceRunUpdate,
  UpdateSequenceStepInput as SequenceStepUpdate,
} from '@auxx/database'
export type {
  SequenceExitReason,
  SequenceRunStatus,
  SequenceStatus,
  SequenceSuppressionReason,
} from './client'
export {
  SEQUENCE_ENROLL_MAX_RECIPIENTS,
  SEQUENCE_EXIT_REASONS,
  SEQUENCE_RUN_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_SUPPRESSION_REASONS,
} from './client'

/** Input shape for {@link import('./crud').createSequence}. */
export interface CreateSequenceInput {
  organizationId: string
  name: string
  description?: string | null
  /** Optional while drafting — publish requires a mailbox before anything sends. */
  integrationId?: string | null
  signatureEntityInstanceId?: string | null
  deliveryStartTime?: string | null
  deliveryEndTime?: string | null
  deliveryTimezone?: string | null
  deliveryBusinessDaysOnly?: boolean
  createdById: string
  /** Event trigger (client-notifications plan §4.1) — defaults to `'manual'` at the schema
   * level when omitted. */
  triggerType?: SequenceTriggerType
  /** Derived from `triggerType` by the caller — null for manual/contact-only sequences. */
  subjectKind?: 'visit' | 'work_order' | 'invoice' | null
  exitOnReply?: boolean
  respectSuppression?: boolean
  includeUnsubscribeFooter?: boolean
  /** Seed idempotency + code lookup key — unique per org. Null for user-created sequences. */
  templateKey?: string | null
  /** `ConditionGroup[]` evaluated at enroll only (decision #17); null = enroll everything. */
  enrollmentFilter?: ConditionGroup[] | null
}

/** Patchable fields for {@link import('./crud').updateSequence}. Any field set here
 * marks the sequence dirty (`hasUnpublishedChanges: true`) if it's already published. */
export interface UpdateSequenceFields {
  name?: string
  description?: string | null
  integrationId?: string
  signatureEntityInstanceId?: string | null
  deliveryStartTime?: string | null
  deliveryEndTime?: string | null
  deliveryTimezone?: string | null
  deliveryBusinessDaysOnly?: boolean
  /** Explicit status change (e.g. pause/resume) — bypasses the dirty-flag logic. Disabling an
   * event-triggered (non-`'manual'`) sequence also bulk-exits its in-flight runs (decision #11). */
  status?: 'draft' | 'enabled' | 'disabled'
  triggerType?: SequenceTriggerType
  subjectKind?: 'visit' | 'work_order' | 'invoice' | null
  exitOnReply?: boolean
  respectSuppression?: boolean
  includeUnsubscribeFooter?: boolean
  templateKey?: string | null
  enrollmentFilter?: ConditionGroup[] | null
}

/** Input shape for {@link import('./steps').createStep}. Appends at the end of the list. */
export interface CreateStepInput {
  sequenceId: string
  organizationId: string
  delayDays?: number
  delayHours?: number
  subject?: string | null
  bodyJson?: Record<string, unknown> | null
  attachmentIds?: string[]
  /** `'relative'` = existing delayDays/delayHours semantics; `'anchor'` = signed offset from
   * the sequence's subject date. Defaults to `'relative'` at the schema level. */
  timingMode?: 'relative' | 'anchor'
  /** Signed day offset from the subject's anchor date — negative = before. Only read when
   * `timingMode: 'anchor'`. */
  anchorOffsetDays?: number
  /** `'HH:MM'` local to the sequence's `deliveryTimezone`. Null falls back to the anchor
   * date's own wall-clock time. */
  anchorTimeOfDay?: string | null
  /** Reserved for SMS — always `'email'` in v1. */
  channel?: string
}

/** Patchable fields for {@link import('./steps').updateStep}. */
export interface UpdateStepFields {
  delayDays?: number
  delayHours?: number
  subject?: string | null
  bodyJson?: Record<string, unknown> | null
  attachmentIds?: string[]
  timingMode?: 'relative' | 'anchor'
  anchorOffsetDays?: number
  anchorTimeOfDay?: string | null
  channel?: string
}

/** Input for {@link import('./steps').reorderStep} — the step lands between
 * `previousStepId` and `nextStepId` (either may be null for start/end of list). */
export interface ReorderStepInput {
  stepId: string
  organizationId: string
  sequenceId: string
  previousStepId?: string | null
  nextStepId?: string | null
}

/** Input for {@link import('./enroll').enrollRecipients}. */
export interface EnrollRecipientsInput {
  sequenceId: string
  organizationId: string
  recipientEntityInstanceIds: string[]
  enrolledById: string
}

/** Per-recipient outcome of an enroll call. */
export interface EnrollRecipientResult {
  recipientId: string
  status: 'enrolled' | 'skipped'
  reason?: string
}

/** Row shape returned by {@link import('./runs').listRuns} — a `SequenceRun` plus
 * the recipient's denormalized display name for the Recipients tab. */
export interface SequenceRunListItem {
  id: string
  organizationId: string
  sequenceId: string
  workflowRunId: string
  recipientEntityInstanceId: string | null
  recipientDisplayName: string | null
  recipientEmail: string
  threadId: string | null
  status: 'active' | 'completed' | 'exited' | 'failed'
  exitReason: SequenceExitReason | null
  exitMetadata: Record<string, unknown> | null
  lastCompletedStep: number
  lastSentAt: Date | null
  enrolledById: string | null
  enrolledAt: Date
  exitedAt: Date | null
}

/** Result of {@link import('./stats').getSequenceStats}. */
export interface SequenceStats {
  enrolled: number
  active: number
  completed: number
  exited: number
  failed: number
  /** 1-based step index -> count of runs that have completed at least that step. */
  perStepSent: Record<number, number>
  /** `exitReason: 'reply'` count / `enrolled`. `0` when nothing is enrolled yet. */
  replyRate: number
  /** `exitReason: 'bounce'` count / `enrolled`. `0` when nothing is enrolled yet. */
  bounceRate: number
}

/** Safe, unauthenticated payload for the public `/sequences/unsubscribe/{token}` page. */
export interface UnsubscribePayload {
  organizationName: string | null
  alreadyUnsubscribed: boolean
}
