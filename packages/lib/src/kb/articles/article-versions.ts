// @auxx/lib/kb/articles/article-versions.ts
import { schema } from '@auxx/database'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError } from '../internal/errors'
import { reloadFlat } from '../internal/flatten-article'
import { verifyArticleExists } from '../internal/validate-existence'
import { clearKopilotSnapshot } from '../kopilot-snapshot'
import type { ArticleNodeJSON } from '../markdown/types'
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

/** One side of a diff: a revision's body + identifying metadata. */
export interface ArticleRevisionBody {
  id: string
  versionNumber: number | null
  label: string | null
  title: string
  contentJson: ArticleNodeJSON[] | null
  createdAt: Date
}

/**
 * Resolve two revisions of an article for diffing. `base`/`compare` accept the
 * sentinels `'draft'` / `'published'` (resolved against the article's current
 * draft/published revision ids) or a literal revision id. Every revision is
 * org-scoped and validated to belong to `articleId`, so an id from another
 * article resolves to `null`.
 */
export async function getArticleDiff(
  ctx: KBContext,
  articleId: string,
  base: string,
  compare: string
): Promise<{ base: ArticleRevisionBody | null; compare: ArticleRevisionBody | null }> {
  const db = resolveDb(ctx)
  try {
    await verifyArticleExists(db, ctx.organizationId, articleId)
    const article = await db.query.Article.findFirst({
      where: and(
        eq(schema.Article.id, articleId),
        eq(schema.Article.organizationId, ctx.organizationId)
      ),
      columns: { draftRevisionId: true, homeKnowledgeBaseId: true },
    })
    if (!article) throw createNotFoundError(`Article with ID '${articleId}' not found`)
    // `published` resolves against the home placement's published revision
    // (publish is per-placement; the home is the canonical baseline).
    const homePlacement = await db.query.ArticlePlacement.findFirst({
      where: and(
        eq(schema.ArticlePlacement.articleId, articleId),
        eq(schema.ArticlePlacement.knowledgeBaseId, article.homeKnowledgeBaseId)
      ),
      columns: { publishedRevisionId: true },
    })

    const resolveRef = (ref: string): string | null =>
      ref === 'draft'
        ? article.draftRevisionId
        : ref === 'published'
          ? (homePlacement?.publishedRevisionId ?? null)
          : ref
    const baseId = resolveRef(base)
    const compareId = resolveRef(compare)

    const ids = [...new Set([baseId, compareId].filter((x): x is string => !!x))]
    const rows = ids.length
      ? await db.query.ArticleRevision.findMany({
          where: and(
            eq(schema.ArticleRevision.articleId, articleId),
            eq(schema.ArticleRevision.organizationId, ctx.organizationId),
            inArray(schema.ArticleRevision.id, ids)
          ),
          columns: {
            id: true,
            versionNumber: true,
            label: true,
            title: true,
            contentJson: true,
            createdAt: true,
          },
        })
      : []

    const byId = new Map(rows.map((r) => [r.id, r]))
    const toBody = (id: string | null): ArticleRevisionBody | null => {
      const r = id ? byId.get(id) : undefined
      if (!r) return null
      return {
        id: r.id,
        versionNumber: r.versionNumber,
        label: r.label,
        title: r.title,
        contentJson: (r.contentJson as ArticleNodeJSON[] | null) ?? null,
        createdAt: r.createdAt,
      }
    }
    return { base: toBody(baseId), compare: toBody(compareId) }
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching article diff', { articleId })
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
      // Restoring rewrites the canonical draft → every placement now lags it.
      await tx
        .update(schema.ArticlePlacement)
        .set({ hasUnpublishedChanges: true, updatedAt: new Date() })
        .where(eq(schema.ArticlePlacement.articleId, article.id))
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
