// @auxx/lib/kb/knowledge-base/publish-knowledge-base.ts
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { KBDraftSettings } from '../draft-settings'
import { resolveDb } from '../internal/context'
import { handleError } from '../internal/errors'
import { verifyKnowledgeBaseExists } from '../internal/validate-existence'
import type { KBContext } from '../types'

type KnowledgeBase = typeof schema.KnowledgeBase.$inferSelect

/**
 * Toggle KB publish state. Updates publishedAt the first time it goes live;
 * lastPublishedAt every time it transitions to PUBLISHED/UNLISTED. Also
 * flushes any pending settings draft onto the live row in the same write,
 * so "Publish site" ships pending presentation changes too.
 */
export async function publishKnowledgeBase(
  ctx: KBContext,
  id: string,
  status: 'PUBLISHED' | 'UNLISTED'
): Promise<KnowledgeBase> {
  const db = resolveDb(ctx)
  try {
    const kb = await verifyKnowledgeBaseExists(db, ctx.organizationId, id)
    const draft = kb.draftSettings as KBDraftSettings | null
    const now = new Date()
    const [updated] = await db
      .update(schema.KnowledgeBase)
      .set({
        ...(draft ?? {}),
        draftSettings: null,
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
