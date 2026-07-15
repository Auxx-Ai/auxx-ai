// packages/lib/src/sequences/client.ts

// Client-safe entry point for the sequences module — plain string-union
// NOTE: no 'use client' directive — this file is also imported by server code
// (sequence router zod schema, enroll.ts cap check); the directive would turn
// every export into a client-reference proxy there.
// constants/types only, no database/server imports. Mirrors the shape of
// `packages/database/src/db/schema/sequence.ts`'s pgEnum columns so the UI
// can render statuses/reasons without pulling in server-only deps.

/** `Sequence.status` — enabled requires `publishedAt` to be set. */
export const SEQUENCE_STATUSES = ['draft', 'enabled', 'disabled'] as const
export type SequenceStatus = (typeof SEQUENCE_STATUSES)[number]

/** `SequenceRun.status`. */
export const SEQUENCE_RUN_STATUSES = ['active', 'completed', 'exited', 'failed'] as const
export type SequenceRunStatus = (typeof SEQUENCE_RUN_STATUSES)[number]

/**
 * `SequenceRun.exitReason` — set whenever `status` is `'exited'`. Client-notifications plan
 * §4.1 adds the last four: `'canceled'` (subject deleted/unscheduled/canceled), `'completed_subject'`
 * (visit-reminder run whose visit finished), `'paid'` (invoice-reminder run whose invoice
 * settled), `'disabled'` (an event-triggered sequence was turned off, bulk-exiting in-flight
 * runs — `exitActiveRunsForSequence`).
 */
export const SEQUENCE_EXIT_REASONS = [
  'reply',
  'bounce',
  'unsubscribe',
  'manual',
  'canceled',
  'completed_subject',
  'paid',
  'disabled',
] as const
export type SequenceExitReason = (typeof SEQUENCE_EXIT_REASONS)[number]

/** `SequenceSuppression.reason`. */
export const SEQUENCE_SUPPRESSION_REASONS = ['unsubscribe', 'manual'] as const
export type SequenceSuppressionReason = (typeof SEQUENCE_SUPPRESSION_REASONS)[number]

/** Bulk-enroll cap per action (plan §15). */
export const SEQUENCE_ENROLL_MAX_RECIPIENTS = 50

/**
 * `Sequence.triggerType` (client-notifications plan §4.1/§4.3) — colon `noun:verb` canonical
 * event-catalog form. Duplicated here (rather than imported from `@auxx/database`) so this
 * file stays free of any server-package import; kept in sync with
 * `packages/database/src/db/schema/sequence.ts`'s `SequenceTriggerType` union by hand — a
 * plain string union over `text()`, not a pgEnum, so new triggers never need a migration.
 * `'manual'` = today's only mode (Recipients tab / contact detail / bulk enrollment).
 */
export const SEQUENCE_TRIGGER_TYPES = [
  'manual',
  'visit:scheduled',
  'visit:en_route',
  'visit:completed',
  'work_order:completed',
  'invoice:sent',
] as const
export type SequenceTriggerType = (typeof SEQUENCE_TRIGGER_TYPES)[number]

/** Human labels for the trigger picker (create dialog + settings drawer badge/select). */
export const SEQUENCE_TRIGGER_LABELS: Record<SequenceTriggerType, string> = {
  manual: 'Manual',
  'visit:scheduled': 'Visit scheduled',
  'visit:en_route': 'Visit en route',
  'visit:completed': 'Visit completed',
  'work_order:completed': 'Job completed',
  'invoice:sent': 'Invoice sent',
}

/** `Sequence.subjectKind` — the record an event-triggered sequence enrolls per-instance, null
 * for `'manual'` (contact-only) sequences. */
export type SequenceSubjectKind = 'visit' | 'work_order' | 'invoice'

/**
 * Derive `Sequence.subjectKind` from a trigger (client-notifications plan §4.7) — the single
 * source of truth both the create dialog and the settings-drawer trigger select use, so the
 * two columns can never desync in the UI layer.
 */
export function deriveSubjectKindFromTrigger(
  triggerType: SequenceTriggerType
): SequenceSubjectKind | null {
  if (triggerType === 'manual') return null
  if (triggerType.startsWith('visit:')) return 'visit'
  if (triggerType === 'work_order:completed') return 'work_order'
  if (triggerType === 'invoice:sent') return 'invoice'
  return null
}

/**
 * Subject kinds whose anchor date the wait processor can actually resolve (§4.2) —
 * `resolveSubjectAnchorDate` only knows `visit.startTime` and the invoice `invoice_due_date`
 * custom field; `work_order` has no anchor date in v1. The step editor uses this to decide
 * whether to offer `timingMode: 'anchor'` at all.
 */
export const SEQUENCE_ANCHORABLE_SUBJECT_KINDS = ['visit', 'invoice'] as const

/** Human label for "N days before/after {anchor}" step-timing copy, by subject kind. */
export const SEQUENCE_ANCHOR_LABELS: Record<'visit' | 'invoice', string> = {
  visit: 'the visit time',
  invoice: 'the due date',
}
