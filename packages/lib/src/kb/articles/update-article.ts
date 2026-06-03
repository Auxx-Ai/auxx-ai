// @auxx/lib/kb/articles/update-article.ts
import { schema } from '@auxx/database'
import { ArticleKind } from '@auxx/database/enums'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { enrichDocWithHighlighting } from '../highlight-code'
import { resolveDb } from '../internal/context'
import { createNotFoundError, handleError, kbLogger as logger } from '../internal/errors'
import { flattenForEditor, reloadFlat } from '../internal/flatten-article'
import { loadArticleTagRecordIds } from '../internal/load-article-tags'
import { enqueueSubtreeMetadataSync } from '../internal/metadata-sync'
import {
  loadArticlePlacementRow,
  loadPlacementRefs,
  resolvePlacement,
  toFlattenRow,
} from '../internal/placement'
import {
  verifyKnowledgeBaseExists,
  verifyParentArticleExists,
} from '../internal/validate-existence'
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
 * Update the canonical draft revision in place. Content is article-wide, so
 * this marks *every* placement of the article as having unpublished changes
 * (each placement's published revision now lags the shared draft).
 *
 * `options.bypassSnapshotClear` / `options.suppressResyncEvent` — see the
 * Kopilot write paths (unchanged).
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
      with: { draftRevision: true },
    })
    if (!article) throw createNotFoundError(`Article with ID '${id}' not found`)
    if (knowledgeBaseId) {
      const placement = await resolvePlacement(db, ctx.organizationId, id, knowledgeBaseId)
      if (!placement) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
        })
      }
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
      // Content is canonical → every placement now lags the draft.
      await tx
        .update(schema.ArticlePlacement)
        .set({ hasUnpublishedChanges: true, updatedAt: new Date() })
        .where(eq(schema.ArticlePlacement.articleId, id))
      await tx
        .update(schema.Article)
        .set({ updatedAt: new Date() })
        .where(eq(schema.Article.id, id))
      await syncArticleDenormalizedFields(id, tx)
    })

    // Manual edit invalidates any pending Kopilot pre-turn snapshot.
    if (!options.bypassSnapshotClear) {
      void clearKopilotSnapshot(id)
    }

    const loaded = await loadArticlePlacementRow(db, ctx.organizationId, id, knowledgeBaseId)
    if (!loaded) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Article ${id} disappeared during update`,
      })
    }
    const [tagIds, placements] = await Promise.all([
      loadArticleTagRecordIds(db, ctx.organizationId, id),
      loadPlacementRefs(db, ctx.organizationId, id),
    ])

    // Realtime push: any subscribed editor swaps to the fresh doc on receipt.
    if (fields.contentJson !== undefined && !options.suppressResyncEvent) {
      const draftJson = (loaded.article.draftRevision?.contentJson ?? null) as
        | ArticleNodeJSON[]
        | null
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

    const row = toFlattenRow(loaded.article, loaded.placement, {
      parentArticleId: loaded.parentArticleId,
      placements,
    })
    return await flattenForEditor(db, ctx.organizationId, row, null, tagIds)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error updating article draft', {
      articleId: id,
    })
  }
}

/**
 * Mutate structural fields (slug, parent, order) on the placement. `aiEnabled`
 * is article-wide and stays on the Article. `articleKind` is immutable. The
 * `knowledgeBaseId` picks the placement (omitted → home placement).
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
    const placement = await resolvePlacement(db, ctx.organizationId, id, knowledgeBaseId)
    if (!placement) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: knowledgeBaseId
          ? `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`
          : `Article ${id} has no placement`,
      })
    }
    const kbId = placement.knowledgeBaseId

    if (fields.slug && fields.slug !== placement.slug) {
      await validateArticleSlugAvailability(db, fields.slug, kbId, id)
    }

    // `fields.parentId` is a parent *article* id → resolve to a placement id.
    let parentPlacementId: string | null | undefined
    if (fields.parentId !== undefined) {
      parentPlacementId = fields.parentId
        ? (await verifyParentArticleExists(db, fields.parentId, kbId)).placementId
        : null
    }

    const placementUpdate: Record<string, unknown> = { updatedAt: new Date() }
    if (fields.slug !== undefined) placementUpdate.slug = fields.slug
    if (parentPlacementId !== undefined) placementUpdate.parentId = parentPlacementId
    // For link kind, the slug *is* the URL — surface a URL change as an
    // unpublished diff so the publish UI prompts the user to re-publish.
    if (
      article.articleKind === ArticleKind.link &&
      fields.slug !== undefined &&
      fields.slug !== placement.slug &&
      placement.isPublished
    ) {
      placementUpdate.hasUnpublishedChanges = true
    }

    if (Object.keys(placementUpdate).length > 1) {
      await db
        .update(schema.ArticlePlacement)
        .set(placementUpdate)
        .where(eq(schema.ArticlePlacement.id, placement.id))
    }

    const aiEnabledChanged =
      fields.aiEnabled !== undefined && fields.aiEnabled !== article.aiEnabled
    if (fields.aiEnabled !== undefined) {
      await db
        .update(schema.Article)
        .set({ aiEnabled: fields.aiEnabled, updatedAt: new Date() })
        .where(eq(schema.Article.id, id))
    }

    // Slug or parent changes shift the slugPath of the entire subtree, so
    // every published descendant's indexed segment metadata also needs a
    // refresh. Otherwise kopilot citations deep-link to the old URL.
    const slugChanged = fields.slug !== undefined && fields.slug !== placement.slug
    const parentChanged =
      parentPlacementId !== undefined && parentPlacementId !== placement.parentId
    if (slugChanged || parentChanged) {
      enqueueSubtreeMetadataSync(db, ctx.organizationId, id, kbId, placement.isPublished)
    }
    // AI toggle gates search inclusion; embedding is canonical (home KB).
    if (aiEnabledChanged && placement.isPublished) {
      void enqueueKBSync({
        type: fields.aiEnabled ? 'sync' : 'unpublish',
        articleId: id,
        kbId: article.homeKnowledgeBaseId,
        organizationId: ctx.organizationId,
      })
    }
    return await reloadFlat(db, ctx.organizationId, id, kbId)
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error updating article structure', {
      articleId: id,
    })
  }
}

/**
 * Batch tree mutations (reorder + parent) on placements. Used by drag-and-drop.
 */
export async function updateArticlesBatch(
  ctx: KBContext,
  knowledgeBaseId: string,
  articles: ArticleBatchUpdateItem[]
): Promise<ArticleListItem[]> {
  const db = resolveDb(ctx)
  try {
    await verifyKnowledgeBaseExists(db, ctx.organizationId, knowledgeBaseId)
    const updatedIds = await db.transaction(async (tx) => {
      const out: string[] = []
      for (const { id, updates } of articles) {
        const existing = await resolvePlacement(tx, ctx.organizationId, id, knowledgeBaseId)
        if (!existing) {
          logger.warn(`Article ${id} not found in KB ${knowledgeBaseId}`)
          continue
        }
        const cleaned: Record<string, unknown> = { updatedAt: new Date() }
        let nextParentPlacementId: string | null | undefined
        if (updates.slug !== undefined) cleaned.slug = updates.slug
        if (updates.parentId !== undefined) {
          nextParentPlacementId = updates.parentId
            ? (await verifyParentArticleExists(tx, updates.parentId, knowledgeBaseId)).placementId
            : null
          cleaned.parentId = nextParentPlacementId
        }
        await tx
          .update(schema.ArticlePlacement)
          .set(cleaned)
          .where(eq(schema.ArticlePlacement.id, existing.id))
        out.push(id)
        const slugChanged = updates.slug !== undefined && updates.slug !== existing.slug
        const parentChanged =
          nextParentPlacementId !== undefined && nextParentPlacementId !== existing.parentId
        if (slugChanged || parentChanged) {
          enqueueSubtreeMetadataSync(
            db,
            ctx.organizationId,
            id,
            knowledgeBaseId,
            existing.isPublished
          )
        }
      }
      return out
    })
    return await Promise.all(
      updatedIds.map((id) => reloadFlat(db, ctx.organizationId, id, knowledgeBaseId))
    )
  } catch (error) {
    return handleError(error, ctx.organizationId, 'Error updating articles batch', {
      knowledgeBaseId,
      articleCount: articles.length,
    })
  }
}
