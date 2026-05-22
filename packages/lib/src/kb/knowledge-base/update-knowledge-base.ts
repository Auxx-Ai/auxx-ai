// @auxx/lib/kb/knowledge-base/update-knowledge-base.ts
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { handleError } from '../internal/errors'
import { verifyKnowledgeBaseExists } from '../internal/validate-existence'
import { validateSlugAvailability } from '../internal/validate-slug'
import type { KBContext, KBLiveInput } from '../types'

type KnowledgeBase = typeof schema.KnowledgeBase.$inferSelect

/**
 * Update live-only KB columns (URL slug, custom domain, visibility, publish
 * status). Draftable presentation fields go through `updateDraftSettings`.
 */
export async function updateKnowledgeBase(
  ctx: KBContext,
  id: string,
  data: KBLiveInput
): Promise<KnowledgeBase> {
  const db = resolveDb(ctx)
  try {
    const existingKb = await verifyKnowledgeBaseExists(db, ctx.organizationId, id)
    if (data.slug && data.slug !== existingKb.slug) {
      await validateSlugAvailability(db, ctx.organizationId, data.slug, id)
    }
    const [updatedKb] = await db
      .update(schema.KnowledgeBase)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.KnowledgeBase.id, id))
      .returning()
    return updatedKb
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error updating knowledge base', { id, data })
  }
}
