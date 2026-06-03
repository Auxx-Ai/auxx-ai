// @auxx/lib/kb/articles/detach-article.ts
import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError } from '../internal/errors'
import type { KBContext } from '../types'

/**
 * Detach a managed (source-owned) article from its source: flip `managed=false`
 * (keeps `sourceId`/`sourceExternalId` for provenance) and clear
 * `linkedFromSourceId` on all its placements. After this the body unlocks and
 * re-sync skips it — the user owns it. Article-wide in Phase 1 (per-placement
 * detach-fork is the Phase 1b multi-home refinement).
 */
export async function detachArticleFromSource(
  ctx: KBContext,
  id: string
): Promise<{ success: boolean }> {
  const db = resolveDb(ctx)
  try {
    const article = await db.query.Article.findFirst({
      where: and(eq(schema.Article.id, id), eq(schema.Article.organizationId, ctx.organizationId)),
      columns: { id: true, managed: true },
    })
    if (!article) throw createNotFoundError(`Article with ID '${id}' not found`)
    if (!article.managed) return { success: true } // already detached / native

    await db.transaction(async (tx) => {
      await tx
        .update(schema.Article)
        .set({ managed: false, updatedAt: new Date() })
        .where(eq(schema.Article.id, id))
      await tx
        .update(schema.ArticlePlacement)
        .set({ linkedFromSourceId: null, updatedAt: new Date() })
        .where(eq(schema.ArticlePlacement.articleId, id))
    })
    return { success: true }
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error detaching article from source', {
      articleId: id,
    })
  }
}
