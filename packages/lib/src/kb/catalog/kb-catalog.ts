// packages/lib/src/kb/catalog/kb-catalog.ts
//
// KB catalog — a compact, DB-derived table of contents of every published,
// AI-enabled article per knowledge base. Injected into agent prompts so the
// model browses the catalog and reads whole articles (`get_article`) instead
// of relying on chunk-level embedding search. Cached per-org (`kbCatalog` org
// cache key); computed fresh at cache-fill time so it can never drift.
// See plans/kb/knowledge-retrieval-plan.md (Phase 2).

import { type Database, schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'

/** One catalog row — a published, AI-enabled article (or container node). */
export interface KbCatalogArticle {
  /** Bare article id — pass to `get_article`. */
  id: string
  title: string
  /** One-liner from the published revision (`description`, falling back to `excerpt`). */
  description: string | null
  /** `page` = readable article; `category`/`header`/`tab` = tree containers. */
  kind: string
  /** Tree indent level (0 = KB root). */
  depth: number
}

/** One KB's slice of the catalog, articles in depth-first tree order. */
export interface KbCatalogEntry {
  id: string
  name: string
  description: string | null
  kind: string
  visibility: string
  articles: KbCatalogArticle[]
}

/** Row shape the pure tree builder consumes — one article placement. */
export interface KbCatalogSourceRow {
  placementId: string
  parentPlacementId: string | null
  /** Fractional-index string (collate C) — plain string compare orders siblings. */
  sortOrder: string
  knowledgeBaseId: string
  articleId: string
  articleKind: string
  aiEnabled: boolean
  archived: boolean
  isPublished: boolean
  title: string | null
  description: string | null
  excerpt: string | null
}

/**
 * Compute the org's KB catalog: every KB (standard, source, learned) with its
 * AI-enabled, non-link articles in tree order. Standard/learned KBs list
 * published placements only; `source` KBs list everything, because source-
 * managed articles embed their draft immediately (`syncManaged`) and placement
 * publish state has no meaning in a hidden pipeline-owned KB — the catalog
 * mirrors what's searchable. Callers apply the PUBLIC-only clamp at render
 * time (`renderKbCatalog`), so INTERNAL KBs are included here.
 */
export async function computeKbCatalog(orgId: string, db: Database): Promise<KbCatalogEntry[]> {
  const [kbs, placements] = await Promise.all([
    db
      .select({
        id: schema.KnowledgeBase.id,
        name: schema.KnowledgeBase.name,
        description: schema.KnowledgeBase.description,
        kind: schema.KnowledgeBase.kind,
        visibility: schema.KnowledgeBase.visibility,
      })
      .from(schema.KnowledgeBase)
      .where(eq(schema.KnowledgeBase.organizationId, orgId)),
    db
      .select({
        placementId: schema.ArticlePlacement.id,
        parentPlacementId: schema.ArticlePlacement.parentId,
        sortOrder: schema.ArticlePlacement.sortOrder,
        knowledgeBaseId: schema.ArticlePlacement.knowledgeBaseId,
        articleId: schema.ArticlePlacement.articleId,
        articleKind: schema.Article.articleKind,
        aiEnabled: schema.Article.aiEnabled,
        status: schema.Article.status,
        isPublished: schema.ArticlePlacement.isPublished,
        articleTitle: schema.Article.title,
        // Prefer the published revision; source-KB drafts fall back to the
        // draft revision via the Article-level columns below.
        revisionTitle: schema.ArticleRevision.title,
        description: schema.ArticleRevision.description,
        excerpt: schema.ArticleRevision.excerpt,
        articleExcerpt: schema.Article.excerpt,
      })
      .from(schema.ArticlePlacement)
      .innerJoin(schema.Article, eq(schema.ArticlePlacement.articleId, schema.Article.id))
      .leftJoin(
        schema.ArticleRevision,
        eq(schema.ArticlePlacement.publishedRevisionId, schema.ArticleRevision.id)
      )
      .where(eq(schema.ArticlePlacement.organizationId, orgId))
      .orderBy(
        asc(schema.ArticlePlacement.knowledgeBaseId),
        asc(schema.ArticlePlacement.sortOrder)
      ),
  ])

  const rows: KbCatalogSourceRow[] = placements.map((p) => ({
    placementId: p.placementId,
    parentPlacementId: p.parentPlacementId,
    sortOrder: p.sortOrder,
    knowledgeBaseId: p.knowledgeBaseId,
    articleId: p.articleId,
    articleKind: p.articleKind,
    aiEnabled: p.aiEnabled,
    archived: p.status === 'ARCHIVED',
    isPublished: p.isPublished,
    title: p.revisionTitle ?? p.articleTitle,
    description: p.description,
    excerpt: p.excerpt ?? p.articleExcerpt,
  }))

  return buildKbCatalog(kbs, rows)
}

/**
 * Pure tree builder (separated from the query for testability). Excluded
 * nodes (link kind, aiEnabled=false, archived) are skipped but their children
 * are promoted to the excluded node's depth; container nodes with no included
 * descendants are dropped.
 */
export function buildKbCatalog(
  kbs: Array<Pick<KbCatalogEntry, 'id' | 'name' | 'description' | 'kind' | 'visibility'>>,
  rows: KbCatalogSourceRow[]
): KbCatalogEntry[] {
  const rowsByKb = new Map<string, KbCatalogSourceRow[]>()
  for (const row of rows) {
    const bucket = rowsByKb.get(row.knowledgeBaseId)
    if (bucket) bucket.push(row)
    else rowsByKb.set(row.knowledgeBaseId, [row])
  }

  return kbs.map((kb) => ({
    id: kb.id,
    name: kb.name,
    description: kb.description,
    kind: kb.kind,
    visibility: kb.visibility,
    // Source KBs embed drafts immediately — no publish gate (see computeKbCatalog).
    articles: buildArticleTree(rowsByKb.get(kb.id) ?? [], {
      requirePublished: kb.kind !== 'source',
    }),
  }))
}

function buildArticleTree(
  rows: KbCatalogSourceRow[],
  { requirePublished }: { requirePublished: boolean }
): KbCatalogArticle[] {
  const childrenByParent = new Map<string | null, KbCatalogSourceRow[]>()
  for (const row of rows) {
    const bucket = childrenByParent.get(row.parentPlacementId)
    if (bucket) bucket.push(row)
    else childrenByParent.set(row.parentPlacementId, [row])
  }
  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
  }

  const knownPlacements = new Set(rows.map((r) => r.placementId))
  const out: KbCatalogArticle[] = []
  const walk = (parentPlacementId: string | null, depth: number): void => {
    for (const row of childrenByParent.get(parentPlacementId) ?? []) {
      const included =
        row.articleKind !== 'link' &&
        row.aiEnabled &&
        !row.archived &&
        (row.isPublished || !requirePublished)
      if (!included) {
        // Promote children — an excluded folder shouldn't hide its articles.
        walk(row.placementId, depth)
        continue
      }
      const index = out.length
      out.push({
        id: row.articleId,
        title: row.title?.trim() || 'Untitled',
        description: row.description?.trim() || row.excerpt?.trim() || null,
        kind: row.articleKind,
        depth,
      })
      walk(row.placementId, depth + 1)
      // A container that ended up with no included descendants is pure noise.
      if (row.articleKind !== 'page' && out.length === index + 1) out.splice(index, 1)
    }
  }
  walk(null, 0)
  // Orphans: published rows whose parent placement isn't published (and so
  // isn't in the row set) would never be reached from the root walk.
  for (const parentId of childrenByParent.keys()) {
    if (parentId !== null && !knownPlacements.has(parentId)) walk(parentId, 0)
  }
  return out
}
