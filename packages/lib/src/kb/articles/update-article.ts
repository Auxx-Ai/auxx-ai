// @auxx/lib/kb/articles/update-article.ts
import { schema } from '@auxx/database'
import { ArticleKind } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { batchGetArticleTagIds } from '../../field-values/relationship-queries'
import { enrichDocWithHighlighting } from '../highlight-code'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError, kbLogger as logger } from '../internal/errors'
import { coverIdsForArticle, flattenForEditor, flattenForList } from '../internal/flatten-article'
import { loadArticleTagRecordIds } from '../internal/load-article-tags'
import { enqueueSubtreeMetadataSync } from '../internal/metadata-sync'
import { resolveCoverUrls } from '../internal/resolve-cover-urls'
import { verifyKnowledgeBaseExists } from '../internal/validate-existence'
import { validateArticleSlugAvailability } from '../internal/validate-slug'
import { enqueueKBSync } from '../kb-sync-queue'
import { clearKopilotSnapshot } from '../kopilot-snapshot'
import { computeArticleJsonHash } from '../markdown/hash'
import { stampBlockIds } from '../markdown/stamp-ids'
import type { ArticleNodeJSON } from '../markdown/types'
import { publishKbArticleEvent } from '../realtime'
import { syncArticleDenormalizedFields } from '../sync-article-denormalized-fields'
import type {
  ArticleBatchUpdateItem,
  ArticleDraftFields,
  ArticleEditorView,
  ArticleListItem,
  ArticleStructureFields,
  KBContext,
} from '../types'

type ArticleRevision = typeof schema.ArticleRevision.$inferSelect

/**
 * Update the draft revision row in place. Marks the article as having
 * unpublished changes. Does not write any structural fields.
 *
 * `options.bypassSnapshotClear` — used by Kopilot's own writes so they
 * don't wipe the pre-turn snapshot they just captured. Default false:
 * any other write path (manual save, restore, etc.) clears the
 * snapshot so a stale Undo button greys out.
 *
 * `options.suppressResyncEvent` — Kopilot writes publish a finer
 * `kb-article-patch` event of their own; suppress the broad resync.
 */
export async function updateArticleDraft(
  ctx: KBContext,
  id: string,
  fields: ArticleDraftFields,
  editorId: string,
  knowledgeBaseId?: string,
  options: {
    bypassSnapshotClear?: boolean
    suppressResyncEvent?: boolean
    originatorSessionId?: string
  } = {}
): Promise<ArticleEditorView> {
  const db = resolveDb(ctx)
  try {
    const article = await db.query.Article.findFirst({
      where: and(eq(schema.Article.id, id), eq(schema.Article.organizationId, ctx.organizationId)),
      with: { publishedRevision: true, draftRevision: true },
    })
    if (!article) throw createNotFoundError(`Article with ID '${id}' not found`)
    if (knowledgeBaseId && article.knowledgeBaseId !== knowledgeBaseId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
      })
    }
    if (!article.draftRevisionId) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Article has no draft revision',
      })
    }

    const draftUpdate: Partial<ArticleRevision> = {
      editorId,
      updatedAt: new Date(),
    }
    if (fields.title !== undefined) draftUpdate.title = fields.title
    if (fields.description !== undefined) draftUpdate.description = fields.description
    if (fields.excerpt !== undefined) draftUpdate.excerpt = fields.excerpt
    if (fields.emoji !== undefined) draftUpdate.emoji = fields.emoji
    if (fields.content !== undefined) draftUpdate.content = fields.content
    if (fields.contentJson !== undefined) {
      const stamped = fields.contentJson ? stampBlockIds(fields.contentJson).content : null
      const enriched = stamped ? await enrichDocWithHighlighting(stamped) : null
      draftUpdate.contentJson = enriched as ArticleRevision['contentJson']
    }
    if (fields.coverImageId !== undefined) draftUpdate.coverImageId = fields.coverImageId

    await db.transaction(async (tx) => {
      await tx
        .update(schema.ArticleRevision)
        .set(draftUpdate)
        .where(eq(schema.ArticleRevision.id, article.draftRevisionId!))
      await tx
        .update(schema.Article)
        .set({ hasUnpublishedChanges: true, updatedAt: new Date() })
        .where(eq(schema.Article.id, id))
      await syncArticleDenormalizedFields(id, tx)
    })

    // Manual edit invalidates any pending Kopilot pre-turn snapshot —
    // the user has accepted/diverged from whatever state the agent
    // was reasoning against, so its Undo affordance no longer makes
    // sense. Skipped for Kopilot's own writes (the agent captured the
    // snapshot before its first op and we want to keep it).
    if (!options.bypassSnapshotClear) {
      void clearKopilotSnapshot(id)
    }

    // Reload with revisions to flatten
    const reloaded = await db.query.Article.findFirst({
      where: eq(schema.Article.id, id),
      with: { publishedRevision: true, draftRevision: true },
    })
    const tagIds = await loadArticleTagRecordIds(db, ctx.organizationId, id)

    // Realtime push: any subscribed editor swaps to the fresh doc on
    // receipt. Manual saves use `resync` (full doc) rather than
    // `patch` because we don't track the per-edit shape on this path.
    // Kopilot writes publish their own kb-article-patch and suppress
    // this broader resync.
    if (fields.contentJson !== undefined && !options.suppressResyncEvent) {
      const draftJson = (reloaded?.draftRevision?.contentJson ?? null) as ArticleNodeJSON[] | null
      if (draftJson) {
        void publishKbArticleEvent(id, {
          type: 'kb-article-resync',
          articleId: id,
          contentJson: draftJson,
          contentHash: computeArticleJsonHash(draftJson),
          cause: { kind: 'manual' },
          originatorSessionId: options.originatorSessionId,
        })
      }
    }

    if (!reloaded) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Article ${id} disappeared during update`,
      })
    }
    return await flattenForEditor(db, ctx.organizationId, reloaded, null, tagIds)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error updating article draft', {
      articleId: id,
    })
  }
}

/**
 * Mutate structural fields (slug, parent, order). Stays on the Article row —
 * no revision side-effects. `articleKind` is immutable post-create.
 */
export async function updateArticleStructure(
  ctx: KBContext,
  id: string,
  fields: ArticleStructureFields,
  knowledgeBaseId?: string
): Promise<ArticleListItem> {
  const db = resolveDb(ctx)
  try {
    const article = await db.query.Article.findFirst({
      where: and(eq(schema.Article.id, id), eq(schema.Article.organizationId, ctx.organizationId)),
    })
    if (!article) throw createNotFoundError(`Article with ID '${id}' not found`)
    if (knowledgeBaseId && article.knowledgeBaseId !== knowledgeBaseId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
      })
    }
    if (fields.slug && fields.slug !== article.slug) {
      await validateArticleSlugAvailability(db, fields.slug, article.knowledgeBaseId, id)
    }
    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (fields.slug !== undefined) updateData.slug = fields.slug
    if (fields.parentId !== undefined) updateData.parentId = fields.parentId
    const aiEnabledChanged =
      fields.aiEnabled !== undefined && fields.aiEnabled !== article.aiEnabled
    if (fields.aiEnabled !== undefined) updateData.aiEnabled = fields.aiEnabled
    // For link kind, the slug *is* the URL — surface a URL change as an
    // unpublished diff so the publish UI prompts the user to re-publish.
    if (
      article.articleKind === ArticleKind.link &&
      fields.slug !== undefined &&
      fields.slug !== article.slug &&
      article.isPublished
    ) {
      updateData.hasUnpublishedChanges = true
    }

    await db.update(schema.Article).set(updateData).where(eq(schema.Article.id, id))

    const reloaded = await db.query.Article.findFirst({
      where: eq(schema.Article.id, id),
      with: { publishedRevision: true, draftRevision: true },
    })
    if (!reloaded) throw createNotFoundError(`Article with ID '${id}' not found`)
    // Slug or parent changes shift the slugPath of the entire subtree, so
    // every published descendant's indexed segment metadata also needs a
    // refresh. Otherwise kopilot citations deep-link to the old URL.
    const slugChanged = fields.slug !== undefined && fields.slug !== article.slug
    const parentChanged = fields.parentId !== undefined && fields.parentId !== article.parentId
    if (slugChanged || parentChanged) {
      enqueueSubtreeMetadataSync(
        db,
        ctx.organizationId,
        id,
        article.knowledgeBaseId,
        article.isPublished
      )
    }
    // AI toggle is the second indexing gate alongside isPublished. Drafts are
    // never indexed, so unpublished rows just persist the flag silently.
    if (aiEnabledChanged && article.isPublished) {
      void enqueueKBSync({
        type: fields.aiEnabled ? 'sync' : 'unpublish',
        articleId: id,
        kbId: article.knowledgeBaseId,
        organizationId: ctx.organizationId,
      })
    }
    const tagIds = await loadArticleTagRecordIds(db, ctx.organizationId, id)
    return await flattenForList(db, ctx.organizationId, reloaded, tagIds)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error updating article structure', {
      articleId: id,
    })
  }
}

/**
 * Batch tree mutations (reorder + parent). Used by drag-and-drop.
 */
export async function updateArticlesBatch(
  ctx: KBContext,
  knowledgeBaseId: string,
  articles: ArticleBatchUpdateItem[]
): Promise<ArticleListItem[]> {
  const db = resolveDb(ctx)
  try {
    await verifyKnowledgeBaseExists(db, ctx.organizationId, knowledgeBaseId)
    const reloadedArticles = await db.transaction(async (tx) => {
      const out: Array<NonNullable<Awaited<ReturnType<typeof tx.query.Article.findFirst>>>> = []
      for (const { id, updates } of articles) {
        const existing = await tx.query.Article.findFirst({
          where: and(
            eq(schema.Article.id, id),
            eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
            eq(schema.Article.organizationId, ctx.organizationId)
          ),
        })
        if (!existing) {
          logger.warn(`Article ${id} not found in KB ${knowledgeBaseId}`)
          continue
        }
        const cleaned: Record<string, unknown> = { updatedAt: new Date() }
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined && ['slug', 'parentId'].includes(key)) {
            cleaned[key] = value
          }
        }
        await tx.update(schema.Article).set(cleaned).where(eq(schema.Article.id, id))
        const reloaded = await tx.query.Article.findFirst({
          where: eq(schema.Article.id, id),
          with: { publishedRevision: true, draftRevision: true },
        })
        if (reloaded) {
          out.push(reloaded)
          const slugChanged = cleaned.slug !== undefined && cleaned.slug !== existing.slug
          const parentChanged =
            cleaned.parentId !== undefined && cleaned.parentId !== existing.parentId
          if (slugChanged || parentChanged) {
            enqueueSubtreeMetadataSync(
              db,
              ctx.organizationId,
              id,
              reloaded.knowledgeBaseId,
              reloaded.isPublished
            )
          }
        }
      }
      return out
    })
    const tagIdMap = await batchGetArticleTagIds(
      db,
      reloadedArticles.map((a) => a.id),
      ctx.organizationId
    )
    const urlMap = await resolveCoverUrls(
      db,
      ctx.organizationId,
      reloadedArticles.flatMap((a) => coverIdsForArticle(a))
    )
    return await Promise.all(
      reloadedArticles.map((a) =>
        flattenForList(db, ctx.organizationId, a, (tagIdMap.get(a.id) ?? []) as RecordId[], urlMap)
      )
    )
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error updating articles batch', {
      knowledgeBaseId,
      articleCount: articles.length,
    })
  }
}
