// packages/lib/src/sequences/suppression.ts
// Org-wide unsubscribe suppression (Sequences plan §8/§3.4) — keyed by
// normalized email, blocks all future enrollments across every sequence in
// the org regardless of which sequence originally triggered it.

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'

/** Lowercase + trim — the normalization applied before every suppression read/write. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Whether `email` (any casing) is suppressed for `organizationId`. */
export async function isSuppressed(
  db: Database,
  organizationId: string,
  email: string
): Promise<boolean> {
  const row = await db.query.SequenceSuppression.findFirst({
    where: and(
      eq(schema.SequenceSuppression.organizationId, organizationId),
      eq(schema.SequenceSuppression.email, normalizeEmail(email))
    ),
    columns: { id: true },
  })
  return !!row
}

export interface UpsertSuppressionInput {
  organizationId: string
  email: string
  contactEntityInstanceId?: string | null
  reason: 'unsubscribe' | 'manual' | 'bounce'
  /** Provenance — the run whose unsubscribe click/action triggered this. */
  sequenceRunId?: string | null
}

/**
 * Insert-or-update the suppression row for `email` in this org. Idempotent —
 * safe to call repeatedly for the same run (e.g. a retried unsubscribe click).
 */
export async function upsertSuppression(
  db: Database,
  input: UpsertSuppressionInput
): Promise<void> {
  const email = normalizeEmail(input.email)
  await db
    .insert(schema.SequenceSuppression)
    .values({
      organizationId: input.organizationId,
      email,
      contactEntityInstanceId: input.contactEntityInstanceId ?? null,
      reason: input.reason,
      sequenceRunId: input.sequenceRunId ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.SequenceSuppression.organizationId, schema.SequenceSuppression.email],
      set: {
        reason: input.reason,
        contactEntityInstanceId: input.contactEntityInstanceId ?? null,
        sequenceRunId: input.sequenceRunId ?? null,
      },
    })
}
