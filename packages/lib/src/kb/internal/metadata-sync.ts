// @auxx/lib/kb/internal/metadata-sync.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { enqueueKBSync } from '../kb-sync-queue'
import { resolvePlacementId } from './placement'

type Db = Database | Transaction

/**
 * Walk the placement subtree under `rootPlacementId` (BFS over placement
 * `parentId`, scoped to KB + org) and collect the *article* ids of every
 * published descendant. Used to refresh indexed segment metadata after a
 * slugPath-shifting change.
 */
export async function getPublishedDescendantIds(
  db: Db,
  organizationId: string,
  rootPlacementId: string,
  knowledgeBaseId: string
): Promise<string[]> {
  const out: string[] = []
  let frontier: string[] = [rootPlacementId]
  while (frontier.length > 0) {
    const children = await db.query.ArticlePlacement.findMany({
      where: and(
        eq(schema.ArticlePlacement.organizationId, organizationId),
        eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
        inArray(schema.ArticlePlacement.parentId, frontier)
      ),
      columns: { id: true, articleId: true, isPublished: true },
    })
    if (children.length === 0) break
    for (const child of children) {
      if (child.isPublished) out.push(child.articleId)
    }
    frontier = children.map((c) => c.id)
  }
  return out
}

/**
 * Enqueue metadata sync for the root (if published) and every published
 * descendant. Fire-and-forget — the placement lookup + BFS happen on a
 * microtask. `rootArticleId` is the moved/renamed article; the subtree is
 * resolved from its placement in `knowledgeBaseId`.
 */
export function enqueueSubtreeMetadataSync(
  db: Db,
  organizationId: string,
  rootArticleId: string,
  knowledgeBaseId: string,
  rootIsPublished: boolean
): void {
  const enqueue = (articleId: string) => {
    void enqueueKBSync({
      type: 'metadata',
      articleId,
      kbId: knowledgeBaseId,
      organizationId,
    })
  }
  if (rootIsPublished) enqueue(rootArticleId)
  void resolvePlacementId(db, organizationId, rootArticleId, knowledgeBaseId).then(
    (rootPlacementId) => {
      if (!rootPlacementId) return
      void getPublishedDescendantIds(db, organizationId, rootPlacementId, knowledgeBaseId).then(
        (ids) => {
          for (const id of ids) enqueue(id)
        }
      )
    }
  )
}
