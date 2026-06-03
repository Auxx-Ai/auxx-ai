// @auxx/lib/kb/internal/article-sort-order.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { kbLogger } from './errors'

type Db = Database | Transaction

export { getNextPlacementSortOrder } from './placement'

/**
 * Highest "Page N" / "page-N" number already used in the KB, plus one. Used
 * to seed placeholder titles/slugs when the user creates an article without
 * filling either in. Slugs live on placements; titles on the draft revision.
 */
export async function findNextPageNumber(
  db: Db,
  organizationId: string,
  knowledgeBaseId: string
): Promise<number> {
  try {
    const placements = await db.query.ArticlePlacement.findMany({
      where: and(
        eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
        eq(schema.ArticlePlacement.organizationId, organizationId),
        sql`${schema.ArticlePlacement.slug} like 'page-%'`
      ),
      columns: { slug: true },
      with: { article: { with: { draftRevision: { columns: { title: true } } } } },
    })
    if (placements.length === 0) return 1
    const numbers: number[] = []
    for (const placement of placements) {
      const slugMatch = placement.slug.match(/^page-(\d+)$/)
      if (slugMatch?.[1]) numbers.push(parseInt(slugMatch[1], 10))
      const titleMatch = placement.article?.draftRevision?.title?.match(/^Page (\d+)$/)
      if (titleMatch?.[1]) numbers.push(parseInt(titleMatch[1], 10))
    }
    return numbers.length > 0 ? Math.max(...numbers) + 1 : 1
  } catch (error) {
    kbLogger.error('Error finding next page number', {
      knowledgeBaseId,
      organizationId,
      error,
    })
    return 1
  }
}
