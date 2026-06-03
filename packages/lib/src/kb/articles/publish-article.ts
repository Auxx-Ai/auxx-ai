// @auxx/lib/kb/articles/publish-article.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { ArticleStatus } from '@auxx/database/enums'
import { TRPCError } from '@trpc/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError } from '../internal/errors'
import { reloadFlat } from '../internal/flatten-article'
import { resolvePlacement } from '../internal/placement'
import { enqueueKBSync } from '../kb-sync-queue'
import { clearKopilotSnapshot } from '../kopilot-snapshot'
import { syncArticleDenormalizedFields } from '../sync-article-denormalized-fields'
import type { ArticleListItem, KBContext } from '../types'

type Db = Database | Transaction
type ArticleRevision = typeof schema.ArticleRevision.$inferSelect
type PlacementRow = typeof schema.ArticlePlacement.$inferSelect
type PlacementWithArticle = PlacementRow & {
  article: typeof schema.Article.$inferSelect & {
    draftRevision: ArticleRevision | null
  }
}

/**
 * Publish a placement (in `knowledgeBaseId`, or the home placement). If the
 * placement's published revision lags the canonical draft (or there is none),
 * snapshots a new ArticleRevision and points the placement at it. Otherwise
 * just flips visibility on.
 *
 * `ancestorIds` opts into a cascade: each id is validated to be a DRAFT
 * (unpublished) placement-ancestor of `id` and published in the same tx, so a
 * leaf becomes visible on the public site.
 */
export async function publishArticle(
  ctx: KBContext,
  id: string,
  editorId: string,
  ancestorIds: string[] = [],
  knowledgeBaseId?: string
): Promise<{ article: ArticleListItem; version: ArticleRevision | null }> {
  const db = resolveDb(ctx)
  try {
    const target = await resolvePlacement(db, ctx.organizationId, id, knowledgeBaseId)
    if (!target) throw createNotFoundError(`Article with ID '${id}' not found`)
    const kbId = target.knowledgeBaseId

    const result = await db.transaction(async (tx) => {
      if (ancestorIds.length > 0) {
        await validateAncestorChain(tx, ctx.organizationId, id, ancestorIds, kbId)
      }

      const orderedIds = [...ancestorIds, id]
      const placements = await tx.query.ArticlePlacement.findMany({
        where: and(
          eq(schema.ArticlePlacement.organizationId, ctx.organizationId),
          eq(schema.ArticlePlacement.knowledgeBaseId, kbId),
          inArray(schema.ArticlePlacement.articleId, orderedIds)
        ),
        with: { article: { with: { draftRevision: true } } },
      })
      const byArticleId = new Map(placements.map((p) => [p.articleId, p as PlacementWithArticle]))

      const homeByArticleId = new Map<string, string>()
      let leafVersion: ArticleRevision | null = null
      for (const articleId of orderedIds) {
        const placement = byArticleId.get(articleId)
        if (!placement) throw createNotFoundError(`Article with ID '${articleId}' not found`)
        if (!placement.article.draftRevision) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Article ${articleId} has no draft revision to publish`,
          })
        }
        homeByArticleId.set(articleId, placement.article.homeKnowledgeBaseId)
        const version = await publishPlacementInTx(tx, ctx.organizationId, placement, editorId)
        if (articleId === id) leafVersion = version
        await syncArticleDenormalizedFields(articleId, tx)
      }
      return { version: leafVersion, homeByArticleId }
    })

    const flat = await reloadFlat(db, ctx.organizationId, id, kbId)
    void enqueueKBSync({
      type: 'sync',
      articleId: id,
      kbId: result.homeByArticleId.get(id) ?? kbId,
      organizationId: ctx.organizationId,
    })
    void clearKopilotSnapshot(id)
    for (const ancestorId of ancestorIds) {
      void enqueueKBSync({
        type: 'sync',
        articleId: ancestorId,
        kbId: result.homeByArticleId.get(ancestorId) ?? kbId,
        organizationId: ctx.organizationId,
      })
      void clearKopilotSnapshot(ancestorId)
    }
    return { article: flat, version: result.version }
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error publishing article', {
      articleId: id,
      ancestorIds,
    })
  }
}

/**
 * Confirm `ancestorIds` is exactly the set of unpublished placement-ancestors
 * of `leafArticleId` in `knowledgeBaseId`, walking up to the first published
 * ancestor. Throws if any id is off-chain, archived, already published, or if a
 * draft ancestor is missing.
 */
async function validateAncestorChain(
  tx: Db,
  organizationId: string,
  leafArticleId: string,
  ancestorIds: string[],
  knowledgeBaseId: string
): Promise<void> {
  const placements = await tx.query.ArticlePlacement.findMany({
    where: and(
      eq(schema.ArticlePlacement.organizationId, organizationId),
      eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId)
    ),
    columns: { id: true, articleId: true, parentId: true, isPublished: true },
    with: { article: { columns: { status: true, title: true } } },
  })
  const byPlacementId = new Map(placements.map((p) => [p.id, p]))
  const byArticleId = new Map(placements.map((p) => [p.articleId, p]))
  const leaf = byArticleId.get(leafArticleId)
  if (!leaf) throw createNotFoundError(`Article with ID '${leafArticleId}' not found`)

  const chainDrafts: string[] = []
  let cursor = leaf.parentId ? byPlacementId.get(leaf.parentId) : undefined
  while (cursor) {
    if (cursor.article.status === ArticleStatus.ARCHIVED) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Ancestor '${cursor.article.title}' is archived. Unarchive it before publishing.`,
      })
    }
    if (cursor.isPublished) break
    chainDrafts.push(cursor.articleId)
    cursor = cursor.parentId ? byPlacementId.get(cursor.parentId) : undefined
  }

  const expected = new Set(chainDrafts)
  for (const id of ancestorIds) {
    if (!expected.has(id)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Ancestor ${id} is not on the publish chain.`,
      })
    }
  }
  for (const id of chainDrafts) {
    if (!ancestorIds.includes(id)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Missing ancestor ${id} from publish cascade.`,
      })
    }
  }
}

/**
 * Publish a single placement inside a tx. Snapshots the canonical draft into a
 * new versioned revision when the placement lags it, points the placement at it,
 * and flips it visible. Also keeps `Article.status` in sync (article-wide).
 */
async function publishPlacementInTx(
  tx: Db,
  organizationId: string,
  placement: PlacementWithArticle,
  editorId: string
): Promise<ArticleRevision | null> {
  const needsNewSnapshot = placement.hasUnpublishedChanges || placement.publishedRevisionId === null

  let newVersion: ArticleRevision | null = null
  let newPublishedRevisionId = placement.publishedRevisionId

  if (needsNewSnapshot) {
    const rows = await tx
      .select({
        next: sql<number>`COALESCE(MAX(${schema.ArticleRevision.versionNumber}), 0) + 1`,
      })
      .from(schema.ArticleRevision)
      .where(eq(schema.ArticleRevision.articleId, placement.articleId))
    const next = rows[0]?.next ?? 1
    const draft = placement.article.draftRevision!
    const [inserted] = await tx
      .insert(schema.ArticleRevision)
      .values({
        articleId: placement.articleId,
        organizationId,
        versionNumber: next,
        title: draft.title,
        description: draft.description,
        excerpt: draft.excerpt,
        emoji: draft.emoji,
        content: draft.content,
        contentJson: draft.contentJson,
        coverImage: draft.coverImage,
        coverImageId: draft.coverImageId,
        editorId,
      })
      .returning()
    if (!inserted) throw new Error('Failed to insert published revision')
    newVersion = inserted
    newPublishedRevisionId = inserted.id
  }

  const now = new Date()
  await tx
    .update(schema.ArticlePlacement)
    .set({
      publishedRevisionId: newPublishedRevisionId,
      isPublished: true,
      publishedAt: placement.publishedAt ?? now,
      publishedById: editorId,
      hasUnpublishedChanges: false,
      updatedAt: now,
    })
    .where(eq(schema.ArticlePlacement.id, placement.id))
  await tx
    .update(schema.Article)
    .set({ status: ArticleStatus.PUBLISHED, updatedAt: now })
    .where(eq(schema.Article.id, placement.articleId))

  return newVersion
}

export async function unpublishArticle(
  ctx: KBContext,
  id: string,
  knowledgeBaseId?: string
): Promise<ArticleListItem> {
  const db = resolveDb(ctx)
  try {
    const placement = await resolvePlacement(db, ctx.organizationId, id, knowledgeBaseId)
    if (!placement) throw createNotFoundError(`Article with ID '${id}' not found`)
    const article = await db.query.Article.findFirst({
      where: eq(schema.Article.id, id),
      columns: { homeKnowledgeBaseId: true },
    })
    await db
      .update(schema.ArticlePlacement)
      .set({ isPublished: false, updatedAt: new Date() })
      .where(eq(schema.ArticlePlacement.id, placement.id))
    await db
      .update(schema.Article)
      .set({ status: ArticleStatus.DRAFT, updatedAt: new Date() })
      .where(eq(schema.Article.id, id))
    await syncArticleDenormalizedFields(id, db)
    void enqueueKBSync({
      type: 'unpublish',
      articleId: id,
      kbId: article?.homeKnowledgeBaseId ?? placement.knowledgeBaseId,
      organizationId: ctx.organizationId,
    })
    return await reloadFlat(db, ctx.organizationId, id, placement.knowledgeBaseId)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error unpublishing article', { articleId: id })
  }
}
