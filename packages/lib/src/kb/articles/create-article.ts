// @auxx/lib/kb/articles/create-article.ts
import { schema } from '@auxx/database'
import { ArticleKind, ArticleStatus } from '@auxx/database/enums'
import type { ArticleKind as ArticleKindType } from '@auxx/database/types'
import { generateId, generateKeyBetween } from '@auxx/utils'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { findNextPageNumber, getNextArticleSortOrder } from '../internal/article-sort-order'
import { resolveDb } from '../internal/context'
import { handleError } from '../internal/errors'
import { flattenForList } from '../internal/flatten-article'
import {
  validateArticleKind,
  verifyKnowledgeBaseExists,
  verifyParentArticleExists,
} from '../internal/validate-existence'
import {
  generateUniqueSlugFromTitle,
  validateArticleSlugAvailability,
} from '../internal/validate-slug'
import { stampBlockIds } from '../markdown/stamp-ids'
import { syncArticleDenormalizedFields } from '../sync-article-denormalized-fields'
import type { ArticleCreateInput, ArticleListItem, KBContext } from '../types'

/**
 * Create a new article + its initial draft revision in one transaction.
 */
export async function createArticle(
  ctx: KBContext,
  knowledgeBaseId: string,
  input: ArticleCreateInput,
  authorId: string,
  orderInfo?: { adjacentId: string; position: 'before' | 'after' }
): Promise<ArticleListItem> {
  const db = resolveDb(ctx)
  try {
    await verifyKnowledgeBaseExists(db, ctx.organizationId, knowledgeBaseId)
    const articleInput = { ...input }
    const kind: ArticleKindType = articleInput.articleKind ?? ArticleKind.page
    articleInput.articleKind = kind
    if (kind === ArticleKind.link) {
      // Title and URL are independent for links. Slug carries the URL —
      // empty URLs get a unique placeholder so the unique constraint
      // doesn't bite when a user creates several empty links in a row.
      if (!articleInput.title || articleInput.title.trim() === '') {
        const n = await findNextPageNumber(db, ctx.organizationId, knowledgeBaseId)
        articleInput.title = `Link ${n}`
      }
      if (!articleInput.slug || articleInput.slug.trim() === '') {
        articleInput.slug = `link-${generateId()}`
      }
    } else if (!articleInput.title || articleInput.title.trim() === '') {
      const nextPageNumber = await findNextPageNumber(db, ctx.organizationId, knowledgeBaseId)
      articleInput.title = `Page ${nextPageNumber}`
      articleInput.slug = `page-${nextPageNumber}`
    } else if (!articleInput.slug || articleInput.slug.trim() === '') {
      articleInput.slug = await generateUniqueSlugFromTitle(db, articleInput.title, knowledgeBaseId)
    }
    await validateArticleSlugAvailability(db, articleInput.slug!, knowledgeBaseId)
    const parent = articleInput.parentId
      ? await verifyParentArticleExists(db, articleInput.parentId, knowledgeBaseId)
      : null
    validateArticleKind(kind, parent)
    let sortOrder: string
    if (orderInfo) {
      const adjacent = await db.query.Article.findFirst({
        where: eq(schema.Article.id, orderInfo.adjacentId),
        columns: { sortOrder: true, parentId: true },
      })
      if (!adjacent) {
        sortOrder = await getNextArticleSortOrder(
          db,
          knowledgeBaseId,
          articleInput.parentId ?? null
        )
      } else {
        if (articleInput.parentId === undefined) articleInput.parentId = adjacent.parentId
        const targetParentId = articleInput.parentId ?? null
        const siblings = await db.query.Article.findMany({
          where: and(
            eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
            targetParentId === null
              ? isNull(schema.Article.parentId)
              : eq(schema.Article.parentId, targetParentId)
          ),
          orderBy: asc(schema.Article.sortOrder),
          columns: { id: true, sortOrder: true },
        })
        const idx = siblings.findIndex((s) => s.id === orderInfo.adjacentId)
        const before = orderInfo.position === 'before'
        const lo = before ? (siblings[idx - 1]?.sortOrder ?? null) : adjacent.sortOrder
        const hi = before ? adjacent.sortOrder : (siblings[idx + 1]?.sortOrder ?? null)
        sortOrder = generateKeyBetween(lo, hi)
      }
    } else {
      sortOrder = await getNextArticleSortOrder(db, knowledgeBaseId, articleInput.parentId ?? null)
    }

    const seededContentJson = articleInput.contentJson
      ? stampBlockIds(articleInput.contentJson).content
      : null

    const result = await db.transaction(async (tx) => {
      // 1. Insert Article with NULL revision pointers (FKs are nullable)
      const [newArticle] = await tx
        .insert(schema.Article)
        .values({
          slug: articleInput.slug || '',
          articleKind: kind,
          parentId: articleInput.parentId ?? null,
          isPublished: false,
          status: ArticleStatus.DRAFT,
          sortOrder,
          knowledgeBaseId,
          organizationId: ctx.organizationId,
          authorId,
          updatedAt: new Date(),
          hasUnpublishedChanges: false,
        })
        .returning()

      // 2. Insert the initial draft revision
      const [newRevision] = await tx
        .insert(schema.ArticleRevision)
        .values({
          articleId: newArticle.id,
          organizationId: ctx.organizationId,
          versionNumber: null,
          title: articleInput.title || '',
          description: articleInput.description ?? null,
          excerpt: articleInput.excerpt ?? null,
          emoji: articleInput.emoji ?? null,
          content: articleInput.content ?? '',
          contentJson: seededContentJson,
          coverImageId: articleInput.coverImageId ?? null,
          editorId: authorId,
        })
        .returning()

      // 3. Wire the pointer
      const [withPointer] = await tx
        .update(schema.Article)
        .set({ draftRevisionId: newRevision.id })
        .where(eq(schema.Article.id, newArticle.id))
        .returning()
      await syncArticleDenormalizedFields(newArticle.id, tx)
      return { article: withPointer, draftRevision: newRevision }
    })

    return await flattenForList(db, ctx.organizationId, {
      ...result.article,
      publishedRevision: null,
      draftRevision: result.draftRevision,
    })
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error creating article', {
      input,
      knowledgeBaseId,
    })
  }
}
