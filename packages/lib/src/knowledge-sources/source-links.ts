// packages/lib/src/knowledge-sources/source-links.ts
// Link a source's content into user-facing KnowledgeBases. A source homes (and embeds)
// its articles once in its own hidden KB; "linking" materializes ArticlePlacement rows for
// individually chosen articles into a target KB (linkedFromSourceId = source.id), placed
// under a chosen parent (e.g. the active tab). Only `page` articles are linkable — never
// categories/structural folders. Unlinking drops just those placements.
// See plans/kb/sources/source-owns-kb-REFACTOR.md.

import { type Database, schema } from '@auxx/database'
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { NotFoundError } from '../errors'

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

/** Remove a single linked article's placement from one KB (source content untouched). */
export async function unlinkSourceArticleFromKb(
  db: Database,
  organizationId: string,
  sourceId: string,
  articleId: string,
  targetKbId: string
): Promise<{ success: boolean }> {
  await loadSource(db, organizationId, sourceId)
  await db
    .delete(schema.ArticlePlacement)
    .where(
      and(
        eq(schema.ArticlePlacement.organizationId, organizationId),
        eq(schema.ArticlePlacement.linkedFromSourceId, sourceId),
        eq(schema.ArticlePlacement.articleId, articleId),
        eq(schema.ArticlePlacement.knowledgeBaseId, targetKbId)
      )
    )
  return { success: true }
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
