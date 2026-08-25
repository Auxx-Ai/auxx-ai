// @auxx/lib/kb/articles/delete-article.ts
import { schema } from '@auxx/database'
import { ArticleKind } from '@auxx/database/enums'
import { generateKeyBetween } from '@auxx/utils'
import { TRPCError } from '@trpc/server'
import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import { sweepEntityFieldValues } from '../../field-values/sweep-entity-references'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError } from '../internal/errors'
import { resolvePlacement } from '../internal/placement'
import { enqueueKBSync } from '../kb-sync-queue'
import type { KBContext } from '../types'

/**
 * Delete an article (content) and all its placements. `knowledgeBaseId` picks
 * the placement whose tree the article currently lives in (for child
 * promotion); omitted → the home placement. Container placements (header/tab)
 * promote their direct children to the container's own parent first.
 *
 * (Multi-home "unlink one KB but keep the content" is a Sources-phase concern;
 * in phase-0 every article has a single placement, so this is a full delete.)
 */
export async function deleteArticle(
  ctx: KBContext,
  id: string,
  knowledgeBaseId?: string
): Promise<{ success: boolean }> {
  const db = resolveDb(ctx)
  try {
    const article = await db.query.Article.findFirst({
      where: and(eq(schema.Article.id, id), eq(schema.Article.organizationId, ctx.organizationId)),
      columns: { id: true, articleKind: true, homeKnowledgeBaseId: true },
    })
    if (!article) throw createNotFoundError(`Article with ID '${id}' not found`)
    const target = await resolvePlacement(db, ctx.organizationId, id, knowledgeBaseId)
    if (!target) throw createNotFoundError(`Article with ID '${id}' not found`)
    if (knowledgeBaseId && target.knowledgeBaseId !== knowledgeBaseId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
      })
    }
    const placement = await db.query.ArticlePlacement.findFirst({
      where: eq(schema.ArticlePlacement.id, target.id),
      with: { children: true },
    })
    if (!placement) throw createNotFoundError(`Article with ID '${id}' not found`)

    const isContainerKind =
      article.articleKind === ArticleKind.header || article.articleKind === ArticleKind.tab
    if (!isContainerKind && placement.children.length > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Cannot delete an article with children. Please remove or reassign children first.',
      })
    }

    await db.transaction(async (tx) => {
      // Promote container children up to the container's own parent, slotting
      // new sortOrder strings into the gap between its siblings.
      if (isContainerKind && placement.children.length > 0) {
        const promotedParentId = placement.parentId
        const siblings = await tx.query.ArticlePlacement.findMany({
          where: and(
            eq(schema.ArticlePlacement.organizationId, ctx.organizationId),
            eq(schema.ArticlePlacement.knowledgeBaseId, placement.knowledgeBaseId),
            promotedParentId === null
              ? isNull(schema.ArticlePlacement.parentId)
              : eq(schema.ArticlePlacement.parentId, promotedParentId),
            ne(schema.ArticlePlacement.id, placement.id)
          ),
          columns: { id: true, sortOrder: true },
          orderBy: asc(schema.ArticlePlacement.sortOrder),
        })
        const lo =
          siblings.filter((s) => s.sortOrder < placement.sortOrder).at(-1)?.sortOrder ?? null
        const hi = siblings.find((s) => s.sortOrder > placement.sortOrder)?.sortOrder ?? null

        const sortedChildren = [...placement.children].sort((a, b) =>
          a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0
        )
        let prevKey = lo
        for (const child of sortedChildren) {
          const newKey = generateKeyBetween(prevKey, hi)
          await tx
            .update(schema.ArticlePlacement)
            .set({ parentId: promotedParentId, sortOrder: newKey, updatedAt: new Date() })
            .where(eq(schema.ArticlePlacement.id, child.id))
          prevKey = newKey
        }
      }

      // Drop revision pointers first to avoid the circular FK blocking the
      // cascade, then delete the article (cascades placements + revisions).
      await tx
        .update(schema.ArticlePlacement)
        .set({ publishedRevisionId: null })
        .where(eq(schema.ArticlePlacement.articleId, id))
      await tx
        .update(schema.Article)
        .set({ draftRevisionId: null })
        .where(eq(schema.Article.id, id))

      // An article's tags (and any other relation to it) live in `FieldValue`
      // on both ends, and neither `entityId` nor `relatedEntityId` has a
      // foreign key — deleting the Article row alone left both halves dangling.
      await sweepEntityFieldValues(tx, {
        organizationId: ctx.organizationId,
        entityIds: [id],
        entityType: 'article',
      })

      await tx.delete(schema.Article).where(eq(schema.Article.id, id))
    })
    void enqueueKBSync({
      type: 'delete',
      articleId: id,
      kbId: article.homeKnowledgeBaseId,
      organizationId: ctx.organizationId,
    })
    return { success: true }
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error deleting article', { articleId: id })
  }
}
