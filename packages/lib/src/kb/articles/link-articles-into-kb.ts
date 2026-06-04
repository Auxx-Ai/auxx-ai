// @auxx/lib/kb/articles/link-articles-into-kb.ts
// Link individually-chosen `page` articles from ANY KB into a target KnowledgeBase by
// materializing ArticlePlacement rows (multi-home). The article's content stays canonical
// (one Article row); each placement decides where it lives + its publish state per KB.
// `linkedFromSourceId` mirrors the article's own `sourceId` so source-derived placements
// stay distinguishable (and unlinkable) from hand-authored ones. Only `page` articles are
// linkable — never categories/structural folders. See plans/kb/sources/link-articles-into-kb-PLAN.md.

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { BadRequestError } from '../../errors'
import { addPlacement } from './add-placement'

/**
 * Resolve an article's placement id within a given KB (placement-id space, which
 * `addPlacement` expects for `parentPlacementId`). Returns null when the article
 * isn't placed in that KB.
 */
async function resolvePlacementId(
  db: Database,
  organizationId: string,
  knowledgeBaseId: string,
  articleId: string
): Promise<string | null> {
  const row = await db.query.ArticlePlacement.findFirst({
    where: and(
      eq(schema.ArticlePlacement.organizationId, organizationId),
      eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
      eq(schema.ArticlePlacement.articleId, articleId)
    ),
    columns: { id: true },
  })
  return row?.id ?? null
}

/**
 * Materialize placements for the chosen `articleIds` into `targetKbId`, each placed under
 * `opts.targetParentArticleId` (e.g. the active tab) or the KB root. Articles may come from
 * any KB (standard or a source's hidden KB). Idempotent — already-placed articles are no-ops.
 * Rejects anything that isn't a `page` (categories/folders/tabs are not linkable).
 */
export async function linkArticlesIntoKb(
  db: Database,
  organizationId: string,
  targetKbId: string,
  articleIds: string[],
  opts?: { targetParentArticleId?: string | null }
): Promise<{ linked: number }> {
  if (articleIds.length === 0) return { linked: 0 }

  // Validate org ownership + kind in one read; carry each article's `sourceId` so the
  // new placement records the same provenance the source-side unlink/summary keys off.
  const articles = await db.query.Article.findMany({
    where: and(
      eq(schema.Article.organizationId, organizationId),
      inArray(schema.Article.id, articleIds)
    ),
    columns: { id: true, articleKind: true, sourceId: true },
  })
  const byId = new Map(articles.map((a) => [a.id, a]))
  for (const id of articleIds) {
    const a = byId.get(id)
    if (!a) throw new BadRequestError(`Article '${id}' not found`)
    if (a.articleKind !== 'page') {
      throw new BadRequestError('Only articles can be linked, not categories or folders')
    }
  }

  // Resolve the attach point to placement-id space once (KB root if unresolved).
  const parentPlacementId = opts?.targetParentArticleId
    ? await resolvePlacementId(db, organizationId, targetKbId, opts.targetParentArticleId)
    : null

  const ctx = { db, organizationId }
  let linked = 0
  for (const articleId of articleIds) {
    await addPlacement(ctx, {
      articleId,
      knowledgeBaseId: targetKbId,
      parentPlacementId,
      linkedFromSourceId: byId.get(articleId)?.sourceId ?? null,
      isPublished: false,
    })
    linked++
  }
  return { linked }
}
