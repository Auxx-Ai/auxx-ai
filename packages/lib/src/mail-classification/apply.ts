// packages/lib/src/mail-classification/apply.ts
// WRITE: idempotent tag application (§3.3) + the classification marker (C9).
//
// ⚠️ INVARIANT 7 — the tag goes through `ThreadMutationService.tagThreadsBulk`
// with `SYSTEM_VISIBILITY`, the same path the `add-tag` filter action uses.
// NEVER a raw `FieldValue` write and never `UnifiedCrudHandler` (which refuses
// `thread` by design): those three keep mail counts, realtime publishes and
// provider label push-back correct, and a "quick direct insert" silently drifts
// all of them.
//
// Heavy dependencies are lazy-imported at call time — a static edge would drag
// the realtime barrel into every importer's graph and break `vi.mock` in unit
// tests (the same reason `mail-filters/actions.ts` does it).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, sql } from 'drizzle-orm'
import { MAIL_CLASSIFICATION_METADATA_KEY, type MailClassificationMarker } from './client'
import type { MailClassificationResult } from './types'

const logger = createScopedLogger('mail-classification')

/**
 * The marker for a completed inference.
 *
 * ⚠️ Exists so the live job and the retroactive run cannot drift. They stamp the
 * same marker for the same reason, and the two call sites were byte-identical
 * blocks — which meant every field added to the marker had to be added twice, and
 * a miss would show up only as "the backfill produced no summaries" long after
 * the fact.
 *
 * Callers must still gate on `result.inferred` themselves (`05-…§12.6`): a
 * marker for a call that never completed disqualifies the message from
 * classification forever, and that decision belongs at the call site where the
 * skip is also counted.
 */
export function toClassificationMarker(result: MailClassificationResult): MailClassificationMarker {
  return {
    at: new Date().toISOString(),
    tagId: result.tagId,
    confidence: result.confidence,
    ...(result.model ? { model: result.model } : {}),
    ...(result.messageSummary ? { messageSummary: result.messageSummary } : {}),
    ...(result.altTagName ? { altTagName: result.altTagName } : {}),
  }
}

/**
 * Apply one classifier-chosen tag to a thread.
 *
 * Accumulate, don't replace (C5): re-adding a tag the thread already carries is
 * a no-op inside `tagThreadsBulk`, and there is no "current category" to clear.
 *
 * Never throws.
 */
export async function applyClassificationTag(params: {
  db: Database
  organizationId: string
  threadId: string
  tagId: string
}): Promise<boolean> {
  const { db, organizationId, threadId, tagId } = params
  try {
    const [{ requireCachedEntityDefId }, { ThreadMutationService }, { SYSTEM_VISIBILITY }] =
      await Promise.all([
        import('../cache'),
        import('../threads/thread-mutation.service'),
        import('../permissions/visibility/context'),
      ])

    const [threadDefId, tagDefId] = await Promise.all([
      requireCachedEntityDefId(organizationId, 'thread'),
      requireCachedEntityDefId(organizationId, 'tag'),
    ])

    // No socketId (nothing to self-echo-suppress) and no actorUserId (there is
    // no human actor) — the classifier is the actor.
    const service = new ThreadMutationService(
      organizationId,
      db,
      undefined,
      undefined,
      SYSTEM_VISIBILITY
    )
    await service.tagThreadsBulk(
      [toRecordId(threadDefId, threadId)],
      [toRecordId(tagDefId, tagId)],
      'add'
    )
    return true
  } catch (error) {
    logger.error('Failed to apply a classified tag — leaving the thread untagged', {
      organizationId,
      threadId,
      tagId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Stamp `Message.metadata.mailClassification` so the message is never classified
 * again (C9, guard exit 5).
 *
 * Written after EVERY completed inference, including the below-threshold ones
 * that applied nothing: the cost has been incurred, and re-inferring the same
 * message would bill twice for the same answer.
 *
 * A `jsonb` concat rather than a read-modify-write, so a concurrent metadata
 * write (bounce ingestion, label sync) cannot be clobbered by a stale snapshot.
 *
 * Never throws.
 */
export async function markMessageClassified(params: {
  db: Database
  organizationId: string
  messageId: string
  marker: MailClassificationMarker
}): Promise<void> {
  const { db, organizationId, messageId, marker } = params
  const patch = JSON.stringify({ [MAIL_CLASSIFICATION_METADATA_KEY]: marker })
  try {
    await db
      .update(schema.Message)
      .set({
        metadata: sql`COALESCE(${schema.Message.metadata}, '{}'::jsonb) || ${patch}::jsonb`,
      })
      .where(
        and(eq(schema.Message.id, messageId), eq(schema.Message.organizationId, organizationId))
      )
  } catch (error) {
    logger.error('Failed to stamp the mail-classification marker', {
      organizationId,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
