// @auxx/lib/kb/articles/list-articles.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { and, asc, eq } from 'drizzle-orm'
import { batchGetArticleTagIds } from '../../field-values/relationship-queries'
import { resolveDb } from '../internal/context'
import { handleError } from '../internal/errors'
import { coverIdsForArticle, flattenForList } from '../internal/flatten-article'
import { toFlattenRow } from '../internal/placement'
import { resolveCoverUrls } from '../internal/resolve-cover-urls'
import { verifyKnowledgeBaseExists } from '../internal/validate-existence'
import type { ArticleListItem, ArticleListOptions, KBContext } from '../types'

/**
 * List articles for a KB as placement-backed tree nodes. Each row's
 * title/emoji/etc. comes from the draft revision (current working state);
 * `parentId` is remapped to article-id space so the frontend tree is unchanged.
 */
export async function getArticles(
  ctx: KBContext,
  knowledgeBaseId: string,
  options: ArticleListOptions = {}
): Promise<ArticleListItem[]> {
  const db = resolveDb(ctx)
  try {
    await verifyKnowledgeBaseExists(db, ctx.organizationId, knowledgeBaseId)
    const placements = await db.query.ArticlePlacement.findMany({
      where: and(
        eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
        eq(schema.ArticlePlacement.organizationId, ctx.organizationId),
        options.includeUnpublished ? undefined : eq(schema.ArticlePlacement.isPublished, true)
      ),
      orderBy: [asc(schema.ArticlePlacement.parentId), asc(schema.ArticlePlacement.sortOrder)],
      with: { article: { with: { draftRevision: true } }, publishedRevision: true },
    })
    return await flattenPlacementList(db, ctx.organizationId, placements)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching knowledge base articles', {
      knowledgeBaseId,
    })
  }
}

/**
 * Every article placement in the org, across all KBs. Same row shape as
 * {@link getArticles}; `knowledgeBaseId` on each row disambiguates.
 */
export async function getAllArticles(
  ctx: KBContext,
  options: ArticleListOptions = {}
): Promise<ArticleListItem[]> {
  const db = resolveDb(ctx)
  try {
    const placements = await db.query.ArticlePlacement.findMany({
      where: and(
        eq(schema.ArticlePlacement.organizationId, ctx.organizationId),
        options.includeUnpublished ? undefined : eq(schema.ArticlePlacement.isPublished, true)
      ),
      orderBy: [
        asc(schema.ArticlePlacement.knowledgeBaseId),
        asc(schema.ArticlePlacement.parentId),
        asc(schema.ArticlePlacement.sortOrder),
      ],
      with: { article: { with: { draftRevision: true } }, publishedRevision: true },
    })
    return await flattenPlacementList(db, ctx.organizationId, placements)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error fetching all articles')
  }
}

type PlacementWith = typeof schema.ArticlePlacement.$inferSelect & {
  article: typeof schema.Article.$inferSelect & {
    draftRevision: typeof schema.ArticleRevision.$inferSelect | null
  }
  publishedRevision: typeof schema.ArticleRevision.$inferSelect | null
}

/** Shared flatten for a list of placement rows: remap parentId, batch covers + tags. */
async function flattenPlacementList(
  db: Database | Transaction,
  organizationId: string,
  placements: PlacementWith[]
): Promise<ArticleListItem[]> {
  // placementId → articleId, so parentId can be remapped to article-id space.
  const idMap = new Map(placements.map((p) => [p.id, p.articleId]))
  const rows = placements.map((p) =>
    toFlattenRow(p.article, p, {
      parentArticleId: p.parentId ? (idMap.get(p.parentId) ?? null) : null,
    })
  )
  const tagIdMap = await batchGetArticleTagIds(
    db as Database,
    rows.map((r) => r.id),
    organizationId
  )
  // Batch-resolve every cover URL in one parallel fan-out (de-duped by id).
  const urlMap = await resolveCoverUrls(
    db,
    organizationId,
    rows.flatMap((r) => coverIdsForArticle(r))
  )
  return await Promise.all(
    rows.map((r) =>
      flattenForList(db, organizationId, r, (tagIdMap.get(r.id) ?? []) as RecordId[], urlMap)
    )
  )
}
