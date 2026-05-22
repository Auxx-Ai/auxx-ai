// @auxx/lib/kb/articles/publish-article.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { ArticleStatus } from '@auxx/database/enums'
import { TRPCError } from '@trpc/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError } from '../internal/errors'
import { flattenForList, reloadFlat } from '../internal/flatten-article'
import { loadArticleTagRecordIds } from '../internal/load-article-tags'
import { verifyArticleExists } from '../internal/validate-existence'
import { enqueueKBSync } from '../kb-sync-queue'
import { clearKopilotSnapshot } from '../kopilot-snapshot'
import { syncArticleDenormalizedFields } from '../sync-article-denormalized-fields'
import type { ArticleListItem, KBContext } from '../types'

type Db = Database | Transaction
type ArticleRow = typeof schema.Article.$inferSelect
type ArticleRevision = typeof schema.ArticleRevision.$inferSelect

/**
 * Publish the article. If the draft has changes (or there is no published
 * revision yet), inserts a new ArticleRevision snapshot with the next
 * versionNumber and points the article at it. Otherwise just toggles
 * visibility back on (no new snapshot).
 *
 * `ancestorIds` opts into a cascade: each id is validated to be a DRAFT
 * ancestor of `id` on the parentId chain, then published in the same
 * transaction. Used to publish a tab/header alongside the leaf so the leaf
 * is visible on the public site.
 */
export async function publishArticle(
  ctx: KBContext,
  id: string,
  editorId: string,
  ancestorIds: string[] = []
): Promise<{ article: ArticleListItem; version: ArticleRevision | null }> {
  const db = resolveDb(ctx)
  try {
    const result = await db.transaction(async (tx) => {
      if (ancestorIds.length > 0) {
        await validateAncestorChain(tx, ctx.organizationId, id, ancestorIds)
      }

      const orderedIds = [...ancestorIds, id]
      const rows = await tx.query.Article.findMany({
        where: and(
          eq(schema.Article.organizationId, ctx.organizationId),
          inArray(schema.Article.id, orderedIds)
        ),
        with: { draftRevision: true },
      })
      const byId = new Map(rows.map((r) => [r.id, r]))

      let leafVersion: ArticleRevision | null = null
      for (const articleId of orderedIds) {
        const row = byId.get(articleId)
        if (!row) throw createNotFoundError(`Article with ID '${articleId}' not found`)
        if (!row.draftRevision) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Article ${articleId} has no draft revision to publish`,
          })
        }
        const version = await publishArticleInTx(tx, ctx.organizationId, row, editorId)
        if (articleId === id) leafVersion = version
        await syncArticleDenormalizedFields(articleId, tx)
      }

      const [updated] = await tx.select().from(schema.Article).where(eq(schema.Article.id, id))
      return { article: updated, version: leafVersion }
    })

    const reloaded = await db.query.Article.findFirst({
      where: eq(schema.Article.id, id),
      with: { publishedRevision: true, draftRevision: true },
    })
    const tagIds = await loadArticleTagRecordIds(db, ctx.organizationId, id)
    const flat = await flattenForList(
      db,
      ctx.organizationId,
      reloaded ?? {
        ...result.article,
        publishedRevision: null,
        draftRevision: null,
      },
      tagIds
    )
    void enqueueKBSync({
      type: 'sync',
      articleId: id,
      kbId: flat.knowledgeBaseId,
      organizationId: ctx.organizationId,
    })
    void clearKopilotSnapshot(id)
    for (const ancestorId of ancestorIds) {
      void enqueueKBSync({
        type: 'sync',
        articleId: ancestorId,
        kbId: flat.knowledgeBaseId,
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
 * Walk the org's article tree to confirm `ancestorIds` is exactly the set of
 * DRAFT ancestors of `leafId` walking up to the first PUBLISHED row. Throws
 * if any id is off-chain, ARCHIVED, already PUBLISHED, or if a DRAFT ancestor
 * is missing from the input.
 */
async function validateAncestorChain(
  tx: Db,
  organizationId: string,
  leafId: string,
  ancestorIds: string[]
): Promise<void> {
  const all = await tx.query.Article.findMany({
    where: eq(schema.Article.organizationId, organizationId),
    columns: { id: true, parentId: true, status: true, isPublished: true, title: true },
  })
  const byId = new Map(all.map((a) => [a.id, a]))
  if (!byId.has(leafId)) {
    throw createNotFoundError(`Article with ID '${leafId}' not found`)
  }

  const chainDrafts: string[] = []
  let cursor = byId.get(leafId)?.parentId ? byId.get(byId.get(leafId)!.parentId!) : undefined
  while (cursor) {
    if (cursor.status === ArticleStatus.ARCHIVED) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Ancestor '${cursor.title}' is archived. Unarchive it before publishing.`,
      })
    }
    if (cursor.status === ArticleStatus.PUBLISHED) break
    chainDrafts.push(cursor.id)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
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
 * Publish a single article row inside an existing transaction. Snapshots the
 * draft revision when needed, flips the article to PUBLISHED. Caller is
 * responsible for chain validation and downstream sync enqueue.
 */
async function publishArticleInTx(
  tx: Db,
  organizationId: string,
  article: ArticleRow & { draftRevision: ArticleRevision | null },
  editorId: string
): Promise<ArticleRevision | null> {
  const needsNewSnapshot = article.hasUnpublishedChanges || article.publishedRevisionId === null

  let newVersion: ArticleRevision | null = null
  let newPublishedRevisionId = article.publishedRevisionId

  if (needsNewSnapshot) {
    const [{ next }] = await tx
      .select({
        next: sql<number>`COALESCE(MAX(${schema.ArticleRevision.versionNumber}), 0) + 1`,
      })
      .from(schema.ArticleRevision)
      .where(eq(schema.ArticleRevision.articleId, article.id))
    const draft = article.draftRevision!
    const [inserted] = await tx
      .insert(schema.ArticleRevision)
      .values({
        articleId: article.id,
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
    newVersion = inserted
    newPublishedRevisionId = inserted.id
  }

  const now = new Date()
  await tx
    .update(schema.Article)
    .set({
      publishedRevisionId: newPublishedRevisionId,
      isPublished: true,
      status: ArticleStatus.PUBLISHED,
      publishedAt: article.publishedAt ?? now,
      publishedById: editorId,
      hasUnpublishedChanges: false,
      updatedAt: now,
    })
    .where(eq(schema.Article.id, article.id))

  return newVersion
}

export async function unpublishArticle(ctx: KBContext, id: string): Promise<ArticleListItem> {
  const db = resolveDb(ctx)
  try {
    const article = await verifyArticleExists(db, ctx.organizationId, id)
    await db
      .update(schema.Article)
      .set({
        isPublished: false,
        status: ArticleStatus.DRAFT,
        updatedAt: new Date(),
      })
      .where(eq(schema.Article.id, article.id))
    await syncArticleDenormalizedFields(id, db)
    void enqueueKBSync({
      type: 'unpublish',
      articleId: id,
      kbId: article.knowledgeBaseId,
      organizationId: ctx.organizationId,
    })
    return await reloadFlat(db, ctx.organizationId, id)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error unpublishing article', { articleId: id })
  }
}
