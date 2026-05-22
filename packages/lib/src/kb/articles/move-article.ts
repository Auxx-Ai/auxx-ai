// @auxx/lib/kb/articles/move-article.ts
import { schema } from '@auxx/database'
import { generateKeyBetween } from '@auxx/utils'
import { TRPCError } from '@trpc/server'
import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import { getNextArticleSortOrder } from '../internal/article-sort-order'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError } from '../internal/errors'
import { reloadFlat } from '../internal/flatten-article'
import { enqueueSubtreeMetadataSync } from '../internal/metadata-sync'
import {
  validateArticleKind,
  verifyKnowledgeBaseExists,
  verifyParentArticleExists,
} from '../internal/validate-existence'
import type { ArticleListItem, KBContext, MoveArticleInput } from '../types'

/**
 * Move an article — change its parent and/or its position among siblings.
 * Single-row write; computes sortOrder via fractional indexing. Tabs are
 * just root articles (`parentId === null`, `articleKind === 'tab'`); they
 * use the same primitive.
 */
export async function moveArticle(
  ctx: KBContext,
  knowledgeBaseId: string,
  input: MoveArticleInput
): Promise<ArticleListItem> {
  const db = resolveDb(ctx)
  try {
    await verifyKnowledgeBaseExists(db, ctx.organizationId, knowledgeBaseId)
    const article = await db.query.Article.findFirst({
      where: and(
        eq(schema.Article.id, input.id),
        eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
        eq(schema.Article.organizationId, ctx.organizationId)
      ),
    })
    if (!article) throw createNotFoundError(`Article with ID '${input.id}' not found`)

    const parent = input.parentId
      ? await verifyParentArticleExists(db, input.parentId, knowledgeBaseId)
      : null
    validateArticleKind(article.articleKind, parent)

    let sortOrder: string
    if (input.sortOrder !== undefined) {
      sortOrder = input.sortOrder
    } else if (input.adjacentId && input.position) {
      const adjacent = await db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, input.adjacentId),
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId)
        ),
        columns: { sortOrder: true, parentId: true },
      })
      if (!adjacent) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Adjacent article '${input.adjacentId}' not found`,
        })
      }
      const siblings = await db.query.Article.findMany({
        where: and(
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          input.parentId === null
            ? isNull(schema.Article.parentId)
            : eq(schema.Article.parentId, input.parentId),
          ne(schema.Article.id, input.id)
        ),
        orderBy: asc(schema.Article.sortOrder),
        columns: { id: true, sortOrder: true },
      })
      const idx = siblings.findIndex((s) => s.id === input.adjacentId)
      const before = input.position === 'before'
      const lo = before ? (siblings[idx - 1]?.sortOrder ?? null) : adjacent.sortOrder
      const hi = before ? adjacent.sortOrder : (siblings[idx + 1]?.sortOrder ?? null)
      sortOrder = generateKeyBetween(lo, hi)
    } else {
      sortOrder = await getNextArticleSortOrder(db, knowledgeBaseId, input.parentId)
    }

    await db
      .update(schema.Article)
      .set({ parentId: input.parentId, sortOrder, updatedAt: new Date() })
      .where(eq(schema.Article.id, input.id))

    // Reparenting shifts the slugPath of the entire subtree — refresh
    // metadata for the moved node and every published descendant.
    if (article.parentId !== input.parentId) {
      enqueueSubtreeMetadataSync(
        db,
        ctx.organizationId,
        input.id,
        knowledgeBaseId,
        article.isPublished
      )
    }

    return await reloadFlat(db, ctx.organizationId, input.id)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error moving article', { input })
  }
}
