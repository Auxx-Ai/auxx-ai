// @auxx/lib/kb/articles/move-article.ts
import { schema } from '@auxx/database'
import { generateKeyBetween } from '@auxx/utils'
import { TRPCError } from '@trpc/server'
import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError } from '../internal/errors'
import { reloadFlat } from '../internal/flatten-article'
import { enqueueSubtreeMetadataSync } from '../internal/metadata-sync'
import { getNextPlacementSortOrder, resolvePlacement } from '../internal/placement'
import {
  validateArticleKind,
  verifyKnowledgeBaseExists,
  verifyParentArticleExists,
} from '../internal/validate-existence'
import type { ArticleListItem, KBContext, MoveArticleInput } from '../types'

/**
 * Move a placement — change its parent and/or position among siblings within a
 * KB. `input.id`/`input.parentId` are *article* ids (frontend space); they're
 * resolved to placements here. Tabs are root placements (`parentId === null`).
 */
export async function moveArticle(
  ctx: KBContext,
  knowledgeBaseId: string,
  input: MoveArticleInput
): Promise<ArticleListItem> {
  const db = resolveDb(ctx)
  try {
    await verifyKnowledgeBaseExists(db, ctx.organizationId, knowledgeBaseId)
    const placement = await resolvePlacement(db, ctx.organizationId, input.id, knowledgeBaseId)
    if (!placement) throw createNotFoundError(`Article with ID '${input.id}' not found`)
    const article = await db.query.Article.findFirst({
      where: eq(schema.Article.id, input.id),
      columns: { articleKind: true },
    })
    if (!article) throw createNotFoundError(`Article with ID '${input.id}' not found`)

    const parent = input.parentId
      ? await verifyParentArticleExists(db, input.parentId, knowledgeBaseId)
      : null
    validateArticleKind(article.articleKind, parent)
    const parentPlacementId = parent?.placementId ?? null

    let sortOrder: string
    if (input.sortOrder !== undefined) {
      sortOrder = input.sortOrder
    } else if (input.adjacentId && input.position) {
      const adjacent = await resolvePlacement(
        db,
        ctx.organizationId,
        input.adjacentId,
        knowledgeBaseId
      )
      if (!adjacent) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Adjacent article '${input.adjacentId}' not found`,
        })
      }
      const siblings = await db.query.ArticlePlacement.findMany({
        where: and(
          eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
          parentPlacementId === null
            ? isNull(schema.ArticlePlacement.parentId)
            : eq(schema.ArticlePlacement.parentId, parentPlacementId),
          ne(schema.ArticlePlacement.id, placement.id)
        ),
        orderBy: asc(schema.ArticlePlacement.sortOrder),
        columns: { id: true, sortOrder: true },
      })
      const idx = siblings.findIndex((s) => s.id === adjacent.id)
      const before = input.position === 'before'
      const lo = before ? (siblings[idx - 1]?.sortOrder ?? null) : adjacent.sortOrder
      const hi = before ? adjacent.sortOrder : (siblings[idx + 1]?.sortOrder ?? null)
      sortOrder = generateKeyBetween(lo, hi)
    } else {
      sortOrder = await getNextPlacementSortOrder(db, knowledgeBaseId, parentPlacementId)
    }

    await db
      .update(schema.ArticlePlacement)
      .set({ parentId: parentPlacementId, sortOrder, updatedAt: new Date() })
      .where(eq(schema.ArticlePlacement.id, placement.id))

    // Reparenting shifts the slugPath of the entire subtree — refresh
    // metadata for the moved node and every published descendant.
    if (placement.parentId !== parentPlacementId) {
      enqueueSubtreeMetadataSync(
        db,
        ctx.organizationId,
        input.id,
        knowledgeBaseId,
        placement.isPublished
      )
    }

    return await reloadFlat(db, ctx.organizationId, input.id, knowledgeBaseId)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error moving article', { input })
  }
}
