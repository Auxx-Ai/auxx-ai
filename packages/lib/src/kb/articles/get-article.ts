// @auxx/lib/kb/articles/get-article.ts
import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError, kbLogger as logger } from '../internal/errors'
import { flattenForEditor } from '../internal/flatten-article'
import { loadArticleTagRecordIds } from '../internal/load-article-tags'
import {
  loadArticlePlacementRow,
  loadPlacementRefs,
  parentArticleIdOf,
  resolvePlacement,
  toFlattenRow,
} from '../internal/placement'
import type { ArticleEditorView, ArticlePlacementRef, KBContext } from '../types'

/** Every KB an article is placed into (the on-demand multi-home surface). */
export async function getArticlePlacements(
  ctx: KBContext,
  articleId: string
): Promise<ArticlePlacementRef[]> {
  const db = resolveDb(ctx)
  try {
    return await loadPlacementRefs(db, ctx.organizationId, articleId)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching article placements', {
      articleId,
    })
  }
}

type ArticleRevision = typeof schema.ArticleRevision.$inferSelect

/**
 * Editor view: the article's draft content + a hint of the published revision
 * (resolved through the relevant placement). Pass `versionNumber` to include a
 * historical revision in `selected*`. `knowledgeBaseId` picks the placement;
 * omitted → the home placement.
 */
export async function getArticleById(
  ctx: KBContext,
  id: string,
  knowledgeBaseId?: string,
  versionNumber?: number
): Promise<ArticleEditorView> {
  const db = resolveDb(ctx)
  try {
    const loaded = await loadArticlePlacementRow(db, ctx.organizationId, id, knowledgeBaseId)
    if (!loaded) throw createNotFoundError(`Article with ID '${id}' not found`)
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
    const [tagIds, placements] = await Promise.all([
      loadArticleTagRecordIds(db, ctx.organizationId, id),
      loadPlacementRefs(db, ctx.organizationId, id),
    ])
    const row = toFlattenRow(loaded.article, loaded.placement, {
      parentArticleId: loaded.parentArticleId,
      placements,
    })
    return await flattenForEditor(db, ctx.organizationId, row, selected, tagIds)
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
    const placement = await db.query.ArticlePlacement.findFirst({
      where: and(
        eq(schema.ArticlePlacement.slug, slug),
        eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
        eq(schema.ArticlePlacement.organizationId, ctx.organizationId)
      ),
      with: { article: { with: { draftRevision: true } }, publishedRevision: true },
    })
    if (!placement) throw createNotFoundError(`Article with slug '${slug}' not found`)
    const [tagIds, placements, parentArticleId] = await Promise.all([
      loadArticleTagRecordIds(db, ctx.organizationId, placement.articleId),
      loadPlacementRefs(db, ctx.organizationId, placement.articleId),
      parentArticleIdOf(db, placement),
    ])
    const row = toFlattenRow(placement.article, placement, { parentArticleId, placements })
    return await flattenForEditor(db, ctx.organizationId, row, null, tagIds)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching article by slug', {
      slug,
      knowledgeBaseId,
    })
  }
}

/**
 * Resolve the slash-joined slug path of an article (in its home KB) by walking
 * placement parents. Used for surgical revalidation of the public site.
 */
export async function getArticleSlugPath(
  ctx: KBContext,
  articleId: string
): Promise<string | undefined> {
  const db = resolveDb(ctx)
  try {
    const placement = await resolvePlacement(db, ctx.organizationId, articleId)
    if (!placement) return undefined
    const path: string[] = []
    let cursor: { id: string; slug: string; parentId: string | null } | undefined = placement
    while (cursor) {
      path.unshift(cursor.slug)
      if (!cursor.parentId) break
      cursor = await db.query.ArticlePlacement.findFirst({
        where: eq(schema.ArticlePlacement.id, cursor.parentId),
        columns: { id: true, slug: true, parentId: true },
      })
    }
    return path.join('/')
  } catch (error) {
    logger.warn('failed to resolve slug path', { articleId, error })
    return undefined
  }
}
