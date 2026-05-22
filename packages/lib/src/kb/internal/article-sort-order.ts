// @auxx/lib/kb/internal/article-sort-order.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { generateKeyBetween } from '@auxx/utils'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { kbLogger } from './errors'

type Db = Database | Transaction

export async function getNextArticleSortOrder(
  db: Db,
  knowledgeBaseId: string,
  parentId: string | null
): Promise<string> {
  const last = await db.query.Article.findFirst({
    where: and(
      eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
      parentId === null ? isNull(schema.Article.parentId) : eq(schema.Article.parentId, parentId)
    ),
    orderBy: desc(schema.Article.sortOrder),
    columns: { sortOrder: true },
  })
  return generateKeyBetween(last?.sortOrder ?? null, null)
}

/**
 * Highest "Page N" / "page-N" number already used in the KB, plus one. Used
 * to seed placeholder titles/slugs when the user creates an article without
 * filling either in.
 */
export async function findNextPageNumber(
  db: Db,
  organizationId: string,
  knowledgeBaseId: string
): Promise<number> {
  try {
    const articles = await db.query.Article.findMany({
      where: and(
        eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
        eq(schema.Article.organizationId, organizationId),
        sql`${schema.Article.slug} like 'page-%'`
      ),
      columns: { slug: true },
      with: { draftRevision: { columns: { title: true } } },
    })
    if (articles.length === 0) return 1
    const numbers: number[] = []
    for (const article of articles) {
      const slugMatch = article.slug.match(/^page-(\d+)$/)
      if (slugMatch) numbers.push(parseInt(slugMatch[1], 10))
      const titleMatch = article.draftRevision?.title?.match(/^Page (\d+)$/)
      if (titleMatch) numbers.push(parseInt(titleMatch[1], 10))
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
