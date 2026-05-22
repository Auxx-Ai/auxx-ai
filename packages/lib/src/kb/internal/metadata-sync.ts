// @auxx/lib/kb/internal/metadata-sync.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { enqueueKBSync } from '../kb-sync-queue'

type Db = Database | Transaction

/**
 * Walk descendants of `rootId` (BFS over `parentId`, scoped to KB + org) and
 * collect the ids of every published descendant. Used to refresh indexed
 * segment metadata after a slugPath-shifting change.
 */
export async function getPublishedDescendantIds(
  db: Db,
  organizationId: string,
  rootId: string,
  knowledgeBaseId: string
): Promise<string[]> {
  const out: string[] = []
  let frontier: string[] = [rootId]
  while (frontier.length > 0) {
    const children = await db.query.Article.findMany({
      where: and(
        eq(schema.Article.organizationId, organizationId),
        eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
        inArray(schema.Article.parentId, frontier)
      ),
      columns: { id: true, isPublished: true },
    })
    if (children.length === 0) break
    for (const child of children) {
      if (child.isPublished) out.push(child.id)
    }
    frontier = children.map((c) => c.id)
  }
  return out
}

/**
 * Enqueue metadata sync for the root (if published) and every published
 * descendant. Fire-and-forget — the BFS query happens on a microtask.
 */
export function enqueueSubtreeMetadataSync(
  db: Db,
  organizationId: string,
  rootId: string,
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
  if (rootIsPublished) enqueue(rootId)
  void getPublishedDescendantIds(db, organizationId, rootId, knowledgeBaseId).then((ids) => {
    for (const id of ids) enqueue(id)
  })
}
