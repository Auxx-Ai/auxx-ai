// packages/lib/src/mail-suggestions/mutations.ts
// Writes for MailSuggestion. Functional Drizzle + neverthrow — no service class.
//
// ZERO permission checks (lib-module-guide §6). The router decides who may see
// or act on a card (§7.2: personal-inbox suggestions are their owner's alone,
// and `isMailAdmin` confers no override) BEFORE calling in here. What lives here
// is shape and integrity only: org scope and the dismissal-is-a-row rule.

import { type Database, schema } from '@auxx/database'
import { and, eq, notInArray, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import { type MailSuggestionDraft, type MailSuggestionRow, toMailSuggestionRow } from './types'

/**
 * Insert or refresh one mined card.
 *
 * `ON CONFLICT (organizationId, inboxId, userId, kind, subjectKey)` — the unique
 * key is declared `NULLS NOT DISTINCT`, so the org-level (`userId IS NULL`)
 * shared-inbox rows collapse too. Without that, every weekly sweep would insert
 * a fresh duplicate of every shared-inbox card.
 *
 * ⚠️ **`setWhere: status = 'new'` is load-bearing.** A decided row must survive
 * the rerun untouched: overwriting a `dismissed` row's evidence would be
 * harmless, but the same UPDATE would have to reset `status`, and resurrecting
 * a dismissed card is exactly what invariant 7 forbids. An `accepted` row is
 * the same story from the other side — the user already built that filter.
 * The miner also skips those subjectKeys up front
 * ({@link listSuppressedSubjectKeys}); this is the belt to that braces, for the
 * race where a user dismisses a card while the sweep is running.
 *
 * Returns `null` when the conflicting row was decided and therefore left alone.
 */
export async function upsertMailSuggestion(
  db: Database,
  organizationId: string,
  draft: MailSuggestionDraft
): Promise<Result<MailSuggestionRow | null, Error>> {
  const [row] = await db
    .insert(schema.MailSuggestion)
    .values({
      organizationId,
      inboxId: draft.inboxId,
      userId: draft.userId,
      kind: draft.kind,
      subjectKey: draft.subjectKey,
      evidence: draft.evidence,
      proposedConditions: draft.proposedConditions,
      proposedActions: draft.proposedActions,
      status: 'new',
    })
    .onConflictDoUpdate({
      target: [
        schema.MailSuggestion.organizationId,
        schema.MailSuggestion.inboxId,
        schema.MailSuggestion.userId,
        schema.MailSuggestion.kind,
        schema.MailSuggestion.subjectKey,
      ],
      set: {
        evidence: draft.evidence,
        proposedConditions: draft.proposedConditions,
        proposedActions: draft.proposedActions,
        updatedAt: new Date(),
      },
      setWhere: eq(schema.MailSuggestion.status, 'new'),
    })
    .returning()

  return ok(row ? toMailSuggestionRow(row) : null)
}

/** Refresh a whole inbox's mined cards; returns how many rows were written. */
export async function upsertMailSuggestions(
  db: Database,
  organizationId: string,
  drafts: MailSuggestionDraft[]
): Promise<Result<number, Error>> {
  let written = 0
  for (const draft of drafts) {
    const result = await upsertMailSuggestion(db, organizationId, draft)
    if (result.isErr()) return err(result.error)
    if (result.value) written++
  }
  return ok(written)
}

/**
 * Drop the inbox's `new` cards that this sweep did NOT re-propose.
 *
 * This is what makes the 5-per-inbox cap (invariant 12) hold ACROSS RUNS rather
 * than only within one: capping the drafts alone would let week 1's five cards
 * and week 2's different five accumulate into ten. It is also what retires a
 * card whose group has fallen back under threshold — the evidence stopped being
 * true, so the proposal should stop being made.
 *
 * Only `new` rows are touched. `dismissed` rows are the suppression list and
 * `accepted` rows are the record that we proposed a filter that now exists.
 *
 * `userId IS NOT DISTINCT FROM` rather than `=`: the shared-inbox rows carry
 * `userId IS NULL`, and `= NULL` matches nothing.
 */
export async function pruneStaleMailSuggestions(
  db: Database,
  organizationId: string,
  params: { inboxId: string; userId: string | null; keepSubjectKeys: string[] }
): Promise<Result<number, Error>> {
  const rows = await db
    .delete(schema.MailSuggestion)
    .where(
      and(
        eq(schema.MailSuggestion.organizationId, organizationId),
        eq(schema.MailSuggestion.inboxId, params.inboxId),
        sql`${schema.MailSuggestion.userId} IS NOT DISTINCT FROM ${params.userId}`,
        eq(schema.MailSuggestion.status, 'new'),
        ...(params.keepSubjectKeys.length > 0
          ? [notInArray(schema.MailSuggestion.subjectKey, params.keepSubjectKeys)]
          : [])
      )
    )
    .returning({ id: schema.MailSuggestion.id })

  return ok(rows.length)
}

/**
 * Dismiss a card — permanently, for that `subjectKey`.
 *
 * A ROW, NOT A DELETE (invariant 7). The dismissed rows are the miner's
 * suppression list; deleting one resurrects the suggestion on the next weekly
 * sweep, which is how an inbox-hygiene feature becomes the thing it was built
 * to remove.
 */
export async function dismissMailSuggestion(
  db: Database,
  organizationId: string,
  suggestionId: string
): Promise<Result<MailSuggestionRow, Error>> {
  const [row] = await db
    .update(schema.MailSuggestion)
    .set({ status: 'dismissed', dismissedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.MailSuggestion.id, suggestionId),
        eq(schema.MailSuggestion.organizationId, organizationId)
      )
    )
    .returning()

  if (!row) return err(new NotFoundError('Suggestion not found'))
  return ok(toMailSuggestionRow(row))
}

/**
 * Record that a card was accepted and which filter it produced.
 *
 * `acceptedFilterId` is plain text with no FK: deleting the filter must not
 * erase the record that we proposed it. The suggestion is a PREFILL, never an
 * authorization path (invariant 10) — the filter itself was created through the
 * ordinary gated create path before this is called.
 */
export async function markMailSuggestionAccepted(
  db: Database,
  organizationId: string,
  suggestionId: string,
  acceptedFilterId: string | null
): Promise<Result<MailSuggestionRow, Error>> {
  const [row] = await db
    .update(schema.MailSuggestion)
    .set({
      status: 'accepted',
      acceptedAt: new Date(),
      acceptedFilterId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.MailSuggestion.id, suggestionId),
        eq(schema.MailSuggestion.organizationId, organizationId)
      )
    )
    .returning()

  if (!row) return err(new NotFoundError('Suggestion not found'))
  return ok(toMailSuggestionRow(row))
}
