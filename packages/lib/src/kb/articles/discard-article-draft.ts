// @auxx/lib/kb/articles/discard-article-draft.ts
import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError } from '../internal/errors'
import { reloadFlat } from '../internal/flatten-article'
import { clearKopilotSnapshot } from '../kopilot-snapshot'
import { syncArticleDenormalizedFields } from '../sync-article-denormalized-fields'
import type { ArticleListItem, KBContext } from '../types'

/**
 * Discard the current draft, copying the published revision's content
 * back into the draft revision row. No-op if there's no published version.
 */
export async function discardArticleDraft(ctx: KBContext, id: string): Promise<ArticleListItem> {
  const db = resolveDb(ctx)
  try {
    const article = await db.query.Article.findFirst({
      where: and(eq(schema.Article.id, id), eq(schema.Article.organizationId, ctx.organizationId)),
      columns: { draftRevisionId: true, homeKnowledgeBaseId: true },
    })
    if (!article) throw createNotFoundError(`Article with ID '${id}' not found`)
    // Discard reverts the canonical draft to the home placement's published
    // baseline (publish is per-placement; the home is the canonical one).
    const homePlacement = await db.query.ArticlePlacement.findFirst({
      where: and(
        eq(schema.ArticlePlacement.articleId, id),
        eq(schema.ArticlePlacement.knowledgeBaseId, article.homeKnowledgeBaseId)
      ),
      with: { publishedRevision: true },
    })
    if (!homePlacement?.publishedRevision || !article.draftRevisionId) {
      // Nothing to discard back to; just clear the dirty flag for tidiness.
      await db
        .update(schema.ArticlePlacement)
        .set({ hasUnpublishedChanges: false, updatedAt: new Date() })
        .where(eq(schema.ArticlePlacement.articleId, id))
      return await reloadFlat(db, ctx.organizationId, id)
    }
    const pub = homePlacement.publishedRevision
    await db.transaction(async (tx) => {
      await tx
        .update(schema.ArticleRevision)
        .set({
          title: pub.title,
          description: pub.description,
          excerpt: pub.excerpt,
          emoji: pub.emoji,
          content: pub.content,
          contentJson: pub.contentJson,
          coverImage: pub.coverImage,
          coverImageId: pub.coverImageId,
          updatedAt: new Date(),
        })
        .where(eq(schema.ArticleRevision.id, article.draftRevisionId!))
      await tx
        .update(schema.ArticlePlacement)
        .set({ hasUnpublishedChanges: false, updatedAt: new Date() })
        .where(eq(schema.ArticlePlacement.articleId, id))
      await syncArticleDenormalizedFields(id, tx)
    })
    void clearKopilotSnapshot(id)
    return await reloadFlat(db, ctx.organizationId, id)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error discarding article draft', {
      articleId: id,
    })
  }
}
