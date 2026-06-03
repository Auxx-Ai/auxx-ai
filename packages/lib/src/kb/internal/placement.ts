// @auxx/lib/kb/internal/placement.ts
//
// The article/placement split is absorbed here so the rest of the service
// layer (and the flatten DTO) keeps working in a familiar "row" shape.
//
// - Article  = canonical content (title/revisions/archivedAt/aiEnabled, the
//   single working `draftRevisionId`).
// - ArticlePlacement = one tree position + publish state per KnowledgeBase.
//
// Invariant relied on throughout: ≤1 placement per (article, KB). So
// `(articleId, knowledgeBaseId)` uniquely identifies a placement, and the
// frontend can keep addressing writes by `(kbId, articleId)`.

import { type Database, schema, type Transaction } from '@auxx/database'
import { generateKeyBetween } from '@auxx/utils'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { ArticlePlacementRef } from '../types'

type Db = Database | Transaction
type RevisionRow = typeof schema.ArticleRevision.$inferSelect
export type ArticleRow = typeof schema.Article.$inferSelect
export type PlacementRow = typeof schema.ArticlePlacement.$inferSelect

/**
 * The placement to operate on for a given article. With kbId, it's the
 * placement in that KB. Without, it's the article's *home* placement (the KB
 * that owns the canonical embedding), falling back to any placement.
 */
export async function resolvePlacement(
  db: Db,
  organizationId: string,
  articleId: string,
  knowledgeBaseId?: string
): Promise<PlacementRow | null> {
  if (knowledgeBaseId) {
    const p = await db.query.ArticlePlacement.findFirst({
      where: and(
        eq(schema.ArticlePlacement.articleId, articleId),
        eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
        eq(schema.ArticlePlacement.organizationId, organizationId)
      ),
    })
    return p ?? null
  }
  const placements = await db.query.ArticlePlacement.findMany({
    where: and(
      eq(schema.ArticlePlacement.articleId, articleId),
      eq(schema.ArticlePlacement.organizationId, organizationId)
    ),
  })
  if (placements.length === 0) return null
  const article = await db.query.Article.findFirst({
    where: eq(schema.Article.id, articleId),
    columns: { homeKnowledgeBaseId: true },
  })
  return (
    placements.find((p) => p.knowledgeBaseId === article?.homeKnowledgeBaseId) ??
    placements[0] ??
    null
  )
}

/** Resolve a placement's id (helper for write paths that only need the id). */
export async function resolvePlacementId(
  db: Db,
  organizationId: string,
  articleId: string,
  knowledgeBaseId?: string
): Promise<string | null> {
  const p = await resolvePlacement(db, organizationId, articleId, knowledgeBaseId)
  return p?.id ?? null
}

/**
 * Next fractional-index sortOrder for a new placement under `parentPlacementId`
 * (null = root) in a KB. Mirrors the old article-space helper, on placements.
 */
export async function getNextPlacementSortOrder(
  db: Db,
  knowledgeBaseId: string,
  parentPlacementId: string | null
): Promise<string> {
  const last = await db.query.ArticlePlacement.findFirst({
    where: and(
      eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
      parentPlacementId === null
        ? isNull(schema.ArticlePlacement.parentId)
        : eq(schema.ArticlePlacement.parentId, parentPlacementId)
    ),
    orderBy: desc(schema.ArticlePlacement.sortOrder),
    columns: { sortOrder: true },
  })
  return generateKeyBetween(last?.sortOrder ?? null, null)
}

/**
 * Merge an Article (content) and one of its placements into the flat "row"
 * shape the flatten layer expects. `parentArticleId` is the parent
 * *placement*'s articleId, so the DTO's `parentId` stays in article-id space
 * (the frontend tree is unchanged). Article-derived fields come from spreading
 * `article`; tree/publish fields are overridden from the placement.
 */
export function toFlattenRow(
  article: ArticleRow & { draftRevision?: RevisionRow | null },
  placement: PlacementRow & { publishedRevision?: RevisionRow | null },
  opts: { parentArticleId?: string | null; placements?: ArticlePlacementRef[] } = {}
) {
  return {
    ...article,
    knowledgeBaseId: placement.knowledgeBaseId,
    slug: placement.slug,
    parentId: opts.parentArticleId ?? null,
    sortOrder: placement.sortOrder,
    isPublished: placement.isPublished,
    hasUnpublishedChanges: placement.hasUnpublishedChanges,
    publishedAt: placement.publishedAt,
    publishedRevisionId: placement.publishedRevisionId,
    publishedRevision: placement.publishedRevision ?? null,
    draftRevision: article.draftRevision ?? null,
    placementId: placement.id,
    placements: opts.placements,
  }
}

/**
 * Load a single article + a target placement (with both revisions) and the
 * parent placement's articleId, ready for {@link toFlattenRow}. `knowledgeBaseId`
 * picks the placement; omitted → the home placement.
 */
export async function loadArticlePlacementRow(
  db: Db,
  organizationId: string,
  articleId: string,
  knowledgeBaseId?: string
): Promise<{
  article: ArticleRow & { draftRevision: RevisionRow | null }
  placement: PlacementRow & { publishedRevision: RevisionRow | null }
  parentArticleId: string | null
} | null> {
  const article = await db.query.Article.findFirst({
    where: and(eq(schema.Article.id, articleId), eq(schema.Article.organizationId, organizationId)),
    with: { draftRevision: true },
  })
  if (!article) return null
  const placement = await resolvePlacement(db, organizationId, articleId, knowledgeBaseId)
  if (!placement) return null
  const publishedRevision = placement.publishedRevisionId
    ? ((await db.query.ArticleRevision.findFirst({
        where: eq(schema.ArticleRevision.id, placement.publishedRevisionId),
      })) ?? null)
    : null
  const parentArticleId = await parentArticleIdOf(db, placement)
  return {
    article,
    placement: { ...placement, publishedRevision },
    parentArticleId,
  }
}

/** Resolve the articleId of a placement's parent (for article-id-space DTOs). */
export async function parentArticleIdOf(db: Db, placement: PlacementRow): Promise<string | null> {
  if (!placement.parentId) return null
  const parent = await db.query.ArticlePlacement.findFirst({
    where: eq(schema.ArticlePlacement.id, placement.parentId),
    columns: { articleId: true },
  })
  return parent?.articleId ?? null
}

/** Every KB this article is placed into (for the on-demand multi-home surface). */
export async function loadPlacementRefs(
  db: Db,
  organizationId: string,
  articleId: string
): Promise<ArticlePlacementRef[]> {
  const placements = await db.query.ArticlePlacement.findMany({
    where: and(
      eq(schema.ArticlePlacement.articleId, articleId),
      eq(schema.ArticlePlacement.organizationId, organizationId)
    ),
    columns: {
      id: true,
      knowledgeBaseId: true,
      slug: true,
      isPublished: true,
      linkedFromSourceId: true,
    },
  })
  return placements.map((p) => ({
    placementId: p.id,
    knowledgeBaseId: p.knowledgeBaseId,
    slug: p.slug,
    isPublished: p.isPublished,
    linkedFromSourceId: p.linkedFromSourceId,
  }))
}
