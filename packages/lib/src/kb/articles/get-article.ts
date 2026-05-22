// @auxx/lib/kb/articles/get-article.ts
import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError, kbLogger as logger } from '../internal/errors'
import { flattenForEditor } from '../internal/flatten-article'
import { loadArticleTagRecordIds } from '../internal/load-article-tags'
import type { ArticleEditorView, KBContext } from '../types'

type ArticleRevision = typeof schema.ArticleRevision.$inferSelect

/**
 * Editor view: returns the article with its draft revision content + a hint
 * of the published revision content for "discard draft" previews. Pass
 * `versionNumber` to additionally include the content of an immutable
 * historical revision in the `selected*` fields.
 */
export async function getArticleById(
  ctx: KBContext,
  id: string,
  knowledgeBaseId?: string,
  versionNumber?: number
): Promise<ArticleEditorView> {
  const db = resolveDb(ctx)
  try {
    const article = await db.query.Article.findFirst({
      where: and(
        eq(schema.Article.id, id),
        eq(schema.Article.organizationId, ctx.organizationId),
        knowledgeBaseId ? eq(schema.Article.knowledgeBaseId, knowledgeBaseId) : undefined
      ),
      with: { publishedRevision: true, draftRevision: true },
    })
    if (!article) throw createNotFoundError(`Article with ID '${id}' not found`)
    let selected: ArticleRevision | null = null
    if (versionNumber !== undefined) {
      const revision = await db.query.ArticleRevision.findFirst({
        where: and(
          eq(schema.ArticleRevision.articleId, id),
          eq(schema.ArticleRevision.organizationId, ctx.organizationId),
          eq(schema.ArticleRevision.versionNumber, versionNumber)
        ),
      })
      if (!revision) {
        throw createNotFoundError(`Version ${versionNumber} not found for article '${id}'`)
      }
      selected = revision
    }
    const tagIds = await loadArticleTagRecordIds(db, ctx.organizationId, id)
    return await flattenForEditor(db, ctx.organizationId, article, selected, tagIds)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching article', { articleId: id })
  }
}

export async function getArticleBySlug(
  ctx: KBContext,
  slug: string,
  knowledgeBaseId: string
): Promise<ArticleEditorView> {
  const db = resolveDb(ctx)
  try {
    const article = await db.query.Article.findFirst({
      where: and(
        eq(schema.Article.slug, slug),
        eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
        eq(schema.Article.organizationId, ctx.organizationId)
      ),
      with: { publishedRevision: true, draftRevision: true },
    })
    if (!article) throw createNotFoundError(`Article with slug '${slug}' not found`)
    const tagIds = await loadArticleTagRecordIds(db, ctx.organizationId, article.id)
    return await flattenForEditor(db, ctx.organizationId, article, null, tagIds)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching article by slug', {
      slug,
      knowledgeBaseId,
    })
  }
}

/**
 * Resolve the slash-joined slug path of an article by walking parentId.
 * Used for surgical revalidation of the public site.
 */
export async function getArticleSlugPath(
  ctx: KBContext,
  articleId: string
): Promise<string | undefined> {
  const db = resolveDb(ctx)
  try {
    const path: string[] = []
    let cursor: { id: string; slug: string; parentId: string | null } | undefined =
      await db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, articleId),
          eq(schema.Article.organizationId, ctx.organizationId)
        ),
        columns: { id: true, slug: true, parentId: true },
      })
    if (!cursor) return undefined
    while (cursor) {
      path.unshift(cursor.slug)
      if (!cursor.parentId) break
      cursor = await db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, cursor.parentId),
          eq(schema.Article.organizationId, ctx.organizationId)
        ),
        columns: { id: true, slug: true, parentId: true },
      })
    }
    return path.join('/')
  } catch (error) {
    logger.warn('failed to resolve slug path', { articleId, error })
    return undefined
  }
}
