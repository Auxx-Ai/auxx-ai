// @auxx/lib/kb/articles/article-versions.ts
import { schema } from '@auxx/database'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, sql } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError } from '../internal/errors'
import { reloadFlat } from '../internal/flatten-article'
import { verifyArticleExists } from '../internal/validate-existence'
import { clearKopilotSnapshot } from '../kopilot-snapshot'
import { syncArticleDenormalizedFields } from '../sync-article-denormalized-fields'
import type { ArticleListItem, KBContext } from '../types'

export async function getArticleVersions(ctx: KBContext, articleId: string) {
  const db = resolveDb(ctx)
  try {
    await verifyArticleExists(db, ctx.organizationId, articleId)
    return await db.query.ArticleRevision.findMany({
      where: and(
        eq(schema.ArticleRevision.articleId, articleId),
        eq(schema.ArticleRevision.organizationId, ctx.organizationId),
        sql`${schema.ArticleRevision.versionNumber} IS NOT NULL`
      ),
      orderBy: desc(schema.ArticleRevision.versionNumber),
      with: { editor: { columns: { id: true, name: true, image: true } } },
    })
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching article versions', {
      articleId,
    })
  }
}

export async function renameArticleVersion(
  ctx: KBContext,
  versionId: string,
  label: string | null
): Promise<void> {
  const db = resolveDb(ctx)
  try {
    await db
      .update(schema.ArticleRevision)
      .set({ label, updatedAt: new Date() })
      .where(
        and(
          eq(schema.ArticleRevision.id, versionId),
          eq(schema.ArticleRevision.organizationId, ctx.organizationId)
        )
      )
  } catch (error) {
    handleError(error, ctx.organizationId, 'Error renaming article version', { versionId })
  }
}

/**
 * Restore a prior version into the draft revision (in-place). Marks the
 * article dirty so the user can preview before publishing.
 */
export async function restoreArticleVersion(
  ctx: KBContext,
  versionId: string,
  editorId: string
): Promise<ArticleListItem> {
  const db = resolveDb(ctx)
  try {
    const version = await db.query.ArticleRevision.findFirst({
      where: and(
        eq(schema.ArticleRevision.id, versionId),
        eq(schema.ArticleRevision.organizationId, ctx.organizationId)
      ),
    })
    if (!version) throw createNotFoundError(`Version with ID '${versionId}' not found`)
    if (version.versionNumber === null) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot restore from a draft revision',
      })
    }
    const article = await db.query.Article.findFirst({
      where: eq(schema.Article.id, version.articleId),
    })
    if (!article || !article.draftRevisionId) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Article has no draft revision',
      })
    }
    await db.transaction(async (tx) => {
      await tx
        .update(schema.ArticleRevision)
        .set({
          title: version.title,
          description: version.description,
          excerpt: version.excerpt,
          emoji: version.emoji,
          content: version.content,
          contentJson: version.contentJson,
          coverImage: version.coverImage,
          coverImageId: version.coverImageId,
          editorId,
          updatedAt: new Date(),
        })
        .where(eq(schema.ArticleRevision.id, article.draftRevisionId!))
      await tx
        .update(schema.Article)
        .set({ hasUnpublishedChanges: true, updatedAt: new Date() })
        .where(eq(schema.Article.id, article.id))
      await syncArticleDenormalizedFields(article.id, tx)
    })
    void clearKopilotSnapshot(article.id)
    return await reloadFlat(db, ctx.organizationId, article.id)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error restoring article version', {
      versionId,
    })
  }
}
