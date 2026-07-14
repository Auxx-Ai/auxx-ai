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

/** `SequenceRun.exitReason` — set whenever `status` is `'exited'`. */
export const SEQUENCE_EXIT_REASONS = ['reply', 'bounce', 'unsubscribe', 'manual'] as const
export type SequenceExitReason = (typeof SEQUENCE_EXIT_REASONS)[number]

/** `SequenceSuppression.reason`. */
export const SEQUENCE_SUPPRESSION_REASONS = ['unsubscribe', 'manual'] as const
export type SequenceSuppressionReason = (typeof SEQUENCE_SUPPRESSION_REASONS)[number]

/** Bulk-enroll cap per action (plan §15). */
export const SEQUENCE_ENROLL_MAX_RECIPIENTS = 50
