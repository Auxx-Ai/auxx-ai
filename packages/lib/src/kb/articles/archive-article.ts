// @auxx/lib/kb/articles/archive-article.ts
import { schema } from '@auxx/database'
import { ArticleStatus } from '@auxx/database/enums'
import { eq } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { handleError } from '../internal/errors'
import { reloadFlat } from '../internal/flatten-article'
import { verifyArticleExists } from '../internal/validate-existence'
import { enqueueKBSync } from '../kb-sync-queue'
import type { ArticleListItem, KBContext } from '../types'

/**
 * Archive is article-wide: sets `archivedAt` + `status`, and unpublishes every
 * placement so the article disappears from all KB trees / public sites. The
 * embed is dropped via the home KB sync.
 */
export async function archiveArticle(ctx: KBContext, id: string): Promise<ArticleListItem> {
  const db = resolveDb(ctx)
  try {
    const article = await verifyArticleExists(db, ctx.organizationId, id)
    await db.transaction(async (tx) => {
      await tx
        .update(schema.Article)
        .set({ status: ArticleStatus.ARCHIVED, archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.Article.id, id))
      await tx
        .update(schema.ArticlePlacement)
        .set({ isPublished: false, updatedAt: new Date() })
        .where(eq(schema.ArticlePlacement.articleId, id))
    })
    void enqueueKBSync({
      type: 'unpublish',
      articleId: id,
      kbId: article.homeKnowledgeBaseId,
      organizationId: ctx.organizationId,
    })
    return await reloadFlat(db, ctx.organizationId, id)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error archiving article', { articleId: id })
  }
}

export async function unarchiveArticle(ctx: KBContext, id: string): Promise<ArticleListItem> {
  const db = resolveDb(ctx)
  try {
    await verifyArticleExists(db, ctx.organizationId, id)
    await db
      .update(schema.Article)
      .set({ status: ArticleStatus.DRAFT, archivedAt: null, updatedAt: new Date() })
      .where(eq(schema.Article.id, id))
    return await reloadFlat(db, ctx.organizationId, id)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error unarchiving article', { articleId: id })
  }
}
