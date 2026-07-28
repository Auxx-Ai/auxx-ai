// @auxx/lib/kb/knowledge-base/publish-knowledge-base.ts
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { KBDraftSettings } from '../draft-settings'
import { resolveDb } from '../internal/context'
import { handleError } from '../internal/errors'
import { verifyKnowledgeBaseExists } from '../internal/validate-existence'
import type { KBContext } from '../types'

type KnowledgeBase = typeof schema.KnowledgeBase.$inferSelect

export interface PublishKBOptions {
  /**
   * Written in the same atomic update as `status`. The two are one user-facing
   * choice — "who can see this site" — so a UI that offers both must not have
   * to make two round trips that can half-fail.
   */
  visibility?: 'PUBLIC' | 'INTERNAL'
  /**
   * Whether to flush the pending settings draft onto the live row.
   *
   * Defaults to "only when the site is going live from DRAFT", because that is
   * the only case the user is performing a *publish*. Editing access on an
   * already-live site is not a publish, and flushing there would silently ship
   * half-finished presentation drafts as a side effect of locking a KB down —
   * exactly when nobody wants unrelated changes going out. Already-live sites
   * publish drafts through the dedicated `publishPendingSettings` path, which
   * the editor's "Publish changes · N" button calls.
   *
   * Pass `true` explicitly to force the old unconditional behaviour.
   */
  flushDraft?: boolean
}

/**
 * Toggle KB publish state, and optionally its visibility, in one write.
 * Updates publishedAt the first time it goes live; lastPublishedAt every time
 * it transitions to PUBLISHED/UNLISTED. See {@link PublishKBOptions.flushDraft}
 * for the draft-flush rule.
 */
export async function publishKnowledgeBase(
  ctx: KBContext,
  id: string,
  status: 'PUBLISHED' | 'UNLISTED',
  options: PublishKBOptions = {}
): Promise<KnowledgeBase> {
  const db = resolveDb(ctx)
  try {
    const kb = await verifyKnowledgeBaseExists(db, ctx.organizationId, id)
    const shouldFlush = options.flushDraft ?? kb.publishStatus === 'DRAFT'
    const draft = shouldFlush ? (kb.draftSettings as KBDraftSettings | null) : null
    const now = new Date()
    const [updated] = await db
      .update(schema.KnowledgeBase)
      .set({
        ...(draft ?? {}),
        ...(shouldFlush ? { draftSettings: null } : {}),
        // After the draft spread: `visibility` is a live column and is never a
        // draftable key, but ordering makes that independent of KBDraftSettings.
        ...(options.visibility ? { visibility: options.visibility } : {}),
        publishStatus: status,
        publishedAt: kb.publishedAt ?? now,
        lastPublishedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.KnowledgeBase.id, id))
      .returning()
    return updated
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error publishing knowledge base', { id, status })
  }
}

export async function unpublishKnowledgeBase(ctx: KBContext, id: string): Promise<KnowledgeBase> {
  const db = resolveDb(ctx)
  try {
    await verifyKnowledgeBaseExists(db, ctx.organizationId, id)
    const [updated] = await db
      .update(schema.KnowledgeBase)
      .set({ publishStatus: 'DRAFT', updatedAt: new Date() })
      .where(eq(schema.KnowledgeBase.id, id))
      .returning()
    return updated
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error unpublishing knowledge base', { id })
  }
}
