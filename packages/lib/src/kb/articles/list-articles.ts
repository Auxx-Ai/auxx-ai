// @auxx/lib/kb/articles/list-articles.ts
import { schema } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { and, asc, eq } from 'drizzle-orm'
import { batchGetArticleTagIds } from '../../field-values/relationship-queries'
import { resolveDb } from '../internal/context'
import { handleError } from '../internal/errors'
import { coverIdsForArticle, flattenForList } from '../internal/flatten-article'
import { resolveCoverUrls } from '../internal/resolve-cover-urls'
import { verifyKnowledgeBaseExists } from '../internal/validate-existence'
import type { ArticleListItem, ArticleListOptions, KBContext } from '../types'

/**
 * List articles for a KB. Each row's title/emoji/etc. is sourced from the
 * published revision when available, falling back to the draft revision
 * (so unpublished articles still show their authoring title in the sidebar).
 */
export async function getArticles(
  ctx: KBContext,
  knowledgeBaseId: string,
  options: ArticleListOptions = {}
): Promise<ArticleListItem[]> {
  const db = resolveDb(ctx)
  try {
    await verifyKnowledgeBaseExists(db, ctx.organizationId, knowledgeBaseId)
    const articles = await db.query.Article.findMany({
      where: and(
        eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
        eq(schema.Article.organizationId, ctx.organizationId),
        options.includeUnpublished ? undefined : eq(schema.Article.isPublished, true)
      ),
      orderBy: [asc(schema.Article.parentId), asc(schema.Article.sortOrder)],
      with: { publishedRevision: true, draftRevision: true },
    })
    const tagIdMap = await batchGetArticleTagIds(
      db,
      articles.map((a) => a.id),
      ctx.organizationId
    )
    // Batch-resolve every cover URL in one parallel fan-out so an N-article
    // KB makes O(unique-asset-count) round-trips, not O(N). resolveCoverUrls
    // de-dupes by id, so passing draft + published per article costs nothing
    // when they share the same asset (the common case).
    const urlMap = await resolveCoverUrls(
      db,
      ctx.organizationId,
      articles.flatMap((a) => coverIdsForArticle(a))
    )
    return await Promise.all(
      articles.map((a) =>
        flattenForList(db, ctx.organizationId, a, (tagIdMap.get(a.id) ?? []) as RecordId[], urlMap)
      )
    )
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching knowledge base articles', {
      knowledgeBaseId,
    })
  }
}

/**
 * Return every article in the org, across all knowledge bases. Same row
 * shape as {@link getArticles}; `knowledgeBaseId` on each row is how the
 * caller disambiguates. Used by global tools that operate across KBs
 * when the user isn't focused on one in particular.
 */
export async function getAllArticles(
  ctx: KBContext,
  options: ArticleListOptions = {}
): Promise<ArticleListItem[]> {
  const db = resolveDb(ctx)
  try {
    const articles = await db.query.Article.findMany({
      where: and(
        eq(schema.Article.organizationId, ctx.organizationId),
        options.includeUnpublished ? undefined : eq(schema.Article.isPublished, true)
      ),
      orderBy: [
        asc(schema.Article.knowledgeBaseId),
        asc(schema.Article.parentId),
        asc(schema.Article.sortOrder),
      ],
      with: { publishedRevision: true, draftRevision: true },
    })
    const tagIdMap = await batchGetArticleTagIds(
      db,
      articles.map((a) => a.id),
      ctx.organizationId
    )
    const urlMap = await resolveCoverUrls(
      db,
      ctx.organizationId,
      articles.flatMap((a) => coverIdsForArticle(a))
    )
    return await Promise.all(
      articles.map((a) =>
        flattenForList(db, ctx.organizationId, a, (tagIdMap.get(a.id) ?? []) as RecordId[], urlMap)
      )
    )
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching all articles')
  }
}
