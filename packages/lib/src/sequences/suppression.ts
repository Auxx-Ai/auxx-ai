// packages/lib/src/sequences/suppression.ts
// Org-wide unsubscribe suppression (Sequences plan §8/§3.4) — keyed by
// normalized email, blocks all future enrollments across every sequence in
// the org regardless of which sequence originally triggered it.

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, ilike, inArray, lt } from 'drizzle-orm'

export type SequenceSuppressionRow = typeof schema.SequenceSuppression.$inferSelect

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

/** One suppressed address from a batched lookup — email is normalized. */
export interface SuppressedEmail {
  email: string
  reason: 'unsubscribe' | 'manual' | 'bounce'
}

/**
 * Batched suppression lookup — returns only the suppressed subset of `emails` with reasons.
 * The composer warning banner's one debounced query (follow-ups plan decision 9).
 */
export async function listSuppressedEmails(
  db: Database,
  organizationId: string,
  emails: string[]
): Promise<SuppressedEmail[]> {
  const normalized = [...new Set(emails.map(normalizeEmail).filter(Boolean))]
  if (normalized.length === 0) return []
  const rows = await db.query.SequenceSuppression.findMany({
    where: and(
      eq(schema.SequenceSuppression.organizationId, organizationId),
      inArray(schema.SequenceSuppression.email, normalized)
    ),
    columns: { email: true, reason: true },
  })
  return rows.map((row) => ({
    email: row.email,
    reason: row.reason as SuppressedEmail['reason'],
  }))
}

export interface ListSuppressionsInput {
  organizationId: string
  /** Case-insensitive substring match on the email. */
  search?: string
  limit: number
  /** Cursor — only rows created strictly before this instant. */
  before?: Date
}

/** Newest-first page of the org's suppression rows (Suppressions settings tab). */
export async function listSuppressions(
  db: Database,
  input: ListSuppressionsInput
): Promise<SequenceSuppressionRow[]> {
  const search = input.search
    ?.trim()
    .toLowerCase()
    .replace(/[%_\\]/g, '\\$&')
  return db.query.SequenceSuppression.findMany({
    where: and(
      eq(schema.SequenceSuppression.organizationId, input.organizationId),
      search ? ilike(schema.SequenceSuppression.email, `%${search}%`) : undefined,
      input.before ? lt(schema.SequenceSuppression.createdAt, input.before) : undefined
    ),
    orderBy: desc(schema.SequenceSuppression.createdAt),
    limit: input.limit,
  })
}

/**
 * Delete a suppression row (= resubscribe the address). Returns false when the
 * row doesn't exist in this org.
 */
export async function deleteSuppression(
  db: Database,
  organizationId: string,
  id: string
): Promise<boolean> {
  const deleted = await db
    .delete(schema.SequenceSuppression)
    .where(
      and(
        eq(schema.SequenceSuppression.organizationId, organizationId),
        eq(schema.SequenceSuppression.id, id)
      )
    )
    .returning({ id: schema.SequenceSuppression.id })
  return deleted.length > 0
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
