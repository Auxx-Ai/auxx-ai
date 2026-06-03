// @auxx/lib/kb/articles/create-article.ts
import { schema } from '@auxx/database'
import { ArticleKind, ArticleStatus } from '@auxx/database/enums'
import type { ArticleKind as ArticleKindType } from '@auxx/database/types'
import { generateId, generateKeyBetween } from '@auxx/utils'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { findNextPageNumber } from '../internal/article-sort-order'
import { resolveDb } from '../internal/context'
import { handleError } from '../internal/errors'
import { flattenForList } from '../internal/flatten-article'
import {
  getNextPlacementSortOrder,
  parentArticleIdOf,
  resolvePlacement,
  toFlattenRow,
} from '../internal/placement'
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
 * Create a new article (content) + its initial draft revision + one placement
 * into `knowledgeBaseId`, in one transaction. The KB is also the article's
 * canonical embedding home (`homeKnowledgeBaseId`).
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

    // `input.parentId` is a parent *article* id (article-id space). Resolve it
    // to the parent placement in this KB.
    const parent = articleInput.parentId
      ? await verifyParentArticleExists(db, articleInput.parentId, knowledgeBaseId)
      : null
    validateArticleKind(kind, parent)
    let parentPlacementId: string | null = parent?.placementId ?? null

    let sortOrder: string
    if (orderInfo) {
      const adjacent = await resolvePlacement(
        db,
        ctx.organizationId,
        orderInfo.adjacentId,
        knowledgeBaseId
      )
      if (!adjacent) {
        sortOrder = await getNextPlacementSortOrder(db, knowledgeBaseId, parentPlacementId)
      } else {
        if (articleInput.parentId === undefined) parentPlacementId = adjacent.parentId
        const siblings = await db.query.ArticlePlacement.findMany({
          where: and(
            eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
            parentPlacementId === null
              ? isNull(schema.ArticlePlacement.parentId)
              : eq(schema.ArticlePlacement.parentId, parentPlacementId)
          ),
          orderBy: asc(schema.ArticlePlacement.sortOrder),
          columns: { id: true, sortOrder: true },
        })
        const idx = siblings.findIndex((s) => s.id === adjacent.id)
        const before = orderInfo.position === 'before'
        const lo = before ? (siblings[idx - 1]?.sortOrder ?? null) : adjacent.sortOrder
        const hi = before ? adjacent.sortOrder : (siblings[idx + 1]?.sortOrder ?? null)
        sortOrder = generateKeyBetween(lo, hi)
      }
    } else {
      sortOrder = await getNextPlacementSortOrder(db, knowledgeBaseId, parentPlacementId)
    }

    const seededContentJson = articleInput.contentJson
      ? stampBlockIds(articleInput.contentJson).content
      : null

    const result = await db.transaction(async (tx) => {
      // 1. Insert Article (content) with NULL revision pointer.
      const [newArticle] = await tx
        .insert(schema.Article)
        .values({
          articleKind: kind,
          status: ArticleStatus.DRAFT,
          homeKnowledgeBaseId: knowledgeBaseId,
          organizationId: ctx.organizationId,
          authorId,
          updatedAt: new Date(),
        })
        .returning()
      if (!newArticle) throw new Error('Failed to insert article')

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
      if (!newRevision) throw new Error('Failed to insert article revision')

      // 3. Wire the draft pointer
      const [withPointer] = await tx
        .update(schema.Article)
        .set({ draftRevisionId: newRevision.id })
        .where(eq(schema.Article.id, newArticle.id))
        .returning()
      if (!withPointer) throw new Error('Failed to wire draft pointer')

      // 4. Insert the placement (tree position + publish state in this KB)
      const [placement] = await tx
        .insert(schema.ArticlePlacement)
        .values({
          organizationId: ctx.organizationId,
          articleId: newArticle.id,
          knowledgeBaseId,
          slug: articleInput.slug || '',
          parentId: parentPlacementId,
          sortOrder,
          isPublished: false,
          hasUnpublishedChanges: false,
          updatedAt: new Date(),
        })
        .returning()
      if (!placement) throw new Error('Failed to insert article placement')

      await syncArticleDenormalizedFields(newArticle.id, tx)
      return { article: withPointer, draftRevision: newRevision, placement }
    })

    const parentArticleId = await parentArticleIdOf(db, result.placement)
    const row = toFlattenRow(
      { ...result.article, draftRevision: result.draftRevision },
      { ...result.placement, publishedRevision: null },
      { parentArticleId }
    )
    return await flattenForList(db, ctx.organizationId, row)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error creating article', {
      input,
      knowledgeBaseId,
    })
  }
}
