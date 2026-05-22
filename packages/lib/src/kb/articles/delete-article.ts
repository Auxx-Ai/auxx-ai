// @auxx/lib/kb/articles/delete-article.ts
import { schema } from '@auxx/database'
import { ArticleKind } from '@auxx/database/enums'
import { generateKeyBetween } from '@auxx/utils'
import { TRPCError } from '@trpc/server'
import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError } from '../internal/errors'
import { enqueueKBSync } from '../kb-sync-queue'
import type { KBContext } from '../types'

export async function deleteArticle(
  ctx: KBContext,
  id: string,
  knowledgeBaseId?: string
): Promise<{ success: boolean }> {
  const db = resolveDb(ctx)
  try {
    const article = await db.query.Article.findFirst({
      where: and(eq(schema.Article.id, id), eq(schema.Article.organizationId, ctx.organizationId)),
      with: { children: true },
    })
    if (!article) throw createNotFoundError(`Article with ID '${id}' not found`)
    if (knowledgeBaseId && article.knowledgeBaseId !== knowledgeBaseId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
      })
    }
    const isContainerKind =
      article.articleKind === ArticleKind.header || article.articleKind === ArticleKind.tab
    if (!isContainerKind && article.children.length > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Cannot delete an article with children. Please remove or reassign children first.',
      })
    }
    // Drop revision pointers first to avoid the circular FK blocking the cascade.
    // For containers (headers + tabs): promote direct children up to the
    // container's own parent — null for tabs, the enclosing tab/null for
    // headers — slotting new sortOrder strings into the gap between the
    // container's previous and next siblings so visual order is preserved.
    await db.transaction(async (tx) => {
      if (isContainerKind && article.children.length > 0) {
        const promotedParentId = article.parentId
        const siblings = await tx.query.Article.findMany({
          where: and(
            eq(schema.Article.organizationId, ctx.organizationId),
            eq(schema.Article.knowledgeBaseId, article.knowledgeBaseId),
            promotedParentId === null
              ? isNull(schema.Article.parentId)
              : eq(schema.Article.parentId, promotedParentId),
            ne(schema.Article.id, id)
          ),
          columns: { id: true, sortOrder: true },
          orderBy: asc(schema.Article.sortOrder),
        })
        const lo = siblings.filter((s) => s.sortOrder < article.sortOrder).at(-1)?.sortOrder ?? null
        const hi = siblings.find((s) => s.sortOrder > article.sortOrder)?.sortOrder ?? null

        const sortedChildren = [...article.children].sort((a, b) =>
          a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0
        )
        let prevKey = lo
        for (const child of sortedChildren) {
          const newKey = generateKeyBetween(prevKey, hi)
          await tx
            .update(schema.Article)
            .set({ parentId: promotedParentId, sortOrder: newKey, updatedAt: new Date() })
            .where(eq(schema.Article.id, child.id))
          prevKey = newKey
        }
      }

      await tx
        .update(schema.Article)
        .set({ publishedRevisionId: null, draftRevisionId: null })
        .where(eq(schema.Article.id, id))
      await tx.delete(schema.Article).where(eq(schema.Article.id, id))
    })
    void enqueueKBSync({
      type: 'delete',
      articleId: id,
      kbId: article.knowledgeBaseId,
      organizationId: ctx.organizationId,
    })
    return { success: true }
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error deleting article', { articleId: id })
  }
}
