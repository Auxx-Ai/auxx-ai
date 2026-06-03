// packages/lib/src/knowledge-sources/source-links.ts
// Link a source's content into user-facing KnowledgeBases. A source homes (and embeds)
// its articles once in its own hidden KB; "linking" materializes ArticlePlacement rows of
// those articles into a target KB (linkedFromSourceId = source.id), preserving the tree.
// Unlinking drops just those placements. See plans/kb/sources/source-owns-kb-REFACTOR.md.

import { type Database, schema } from '@auxx/database'
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { NotFoundError } from '../errors'
import { addPlacement } from '../kb/articles/add-placement'
import { getArticles } from '../kb/articles/list-articles'

async function loadSource(db: Database, organizationId: string, sourceId: string) {
  const source = await db.query.KnowledgeSource.findFirst({
    where: and(
      eq(schema.KnowledgeSource.id, sourceId),
      eq(schema.KnowledgeSource.organizationId, organizationId)
    ),
    columns: { id: true, ownedKnowledgeBaseId: true },
  })
  if (!source) throw new NotFoundError(`Knowledge source '${sourceId}' not found`)
  return source
}

/**
 * Materialize placements of every article in the source's owned KB into `targetKbId`,
 * preserving the tree (parents before children). Idempotent — re-linking is a no-op for
 * articles already placed there (so it doubles as the re-sync fan-out backfill).
 */
export async function linkSourceToKb(
  db: Database,
  organizationId: string,
  sourceId: string,
  targetKbId: string
): Promise<{ linked: number }> {
  const source = await loadSource(db, organizationId, sourceId)
  if (targetKbId === source.ownedKnowledgeBaseId) return { linked: 0 }

  const ctx = { db, organizationId }
  const items = await getArticles(ctx, source.ownedKnowledgeBaseId, { includeUnpublished: true })

  // Place parent-first so each child's parentPlacementId resolves to the new placement.
  const newPlacementByArticle = new Map<string, string>()
  const remaining = [...items]
  let linked = 0
  let progress = true
  while (remaining.length > 0 && progress) {
    progress = false
    for (let i = remaining.length - 1; i >= 0; i--) {
      const item = remaining[i]!
      if (item.parentId && !newPlacementByArticle.has(item.parentId)) continue
      const placement = await addPlacement(ctx, {
        articleId: item.id,
        knowledgeBaseId: targetKbId,
        parentPlacementId: item.parentId
          ? (newPlacementByArticle.get(item.parentId) ?? null)
          : null,
        sortOrder: item.sortOrder,
        linkedFromSourceId: sourceId,
        isPublished: false,
      })
      newPlacementByArticle.set(item.id, placement.id)
      remaining.splice(i, 1)
      linked++
      progress = true
    }
  }
  return { linked }
}

/** Remove a source's links from one KB (deletes those placements; cascades children). */
export async function unlinkSourceFromKb(
  db: Database,
  organizationId: string,
  sourceId: string,
  targetKbId: string
): Promise<{ success: boolean }> {
  await loadSource(db, organizationId, sourceId)
  await db
    .delete(schema.ArticlePlacement)
    .where(
      and(
        eq(schema.ArticlePlacement.organizationId, organizationId),
        eq(schema.ArticlePlacement.linkedFromSourceId, sourceId),
        eq(schema.ArticlePlacement.knowledgeBaseId, targetKbId)
      )
    )
  return { success: true }
}

/** The user-facing KBs a source is linked into (derived from its linked placements). */
export async function listSourceLinks(
  db: Database,
  organizationId: string,
  sourceId: string
): Promise<{ id: string; name: string }[]> {
  const source = await loadSource(db, organizationId, sourceId)
  const rows = await db
    .selectDistinct({ knowledgeBaseId: schema.ArticlePlacement.knowledgeBaseId })
    .from(schema.ArticlePlacement)
    .where(
      and(
        eq(schema.ArticlePlacement.organizationId, organizationId),
        eq(schema.ArticlePlacement.linkedFromSourceId, sourceId),
        isNotNull(schema.ArticlePlacement.linkedFromSourceId),
        ne(schema.ArticlePlacement.knowledgeBaseId, source.ownedKnowledgeBaseId)
      )
    )
  const kbIds = rows.map((r) => r.knowledgeBaseId)
  if (kbIds.length === 0) return []
  const kbs = await db.query.KnowledgeBase.findMany({
    where: and(
      eq(schema.KnowledgeBase.organizationId, organizationId),
      eq(schema.KnowledgeBase.kind, 'standard')
    ),
    columns: { id: true, name: true },
  })
  const nameById = new Map(kbs.map((k) => [k.id, k.name]))
  return kbIds.filter((id) => nameById.has(id)).map((id) => ({ id, name: nameById.get(id) ?? id }))
}
