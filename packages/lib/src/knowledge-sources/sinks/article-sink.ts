// packages/lib/src/knowledge-sources/sinks/article-sink.ts
// The default (publishable) sink: materialize a Locked managed Article per item,
// filed by path under the source root folder, then embed via the shared core
// (sync-managed). Re-sync overwrites the draft on content change; orphans archive.

import { archiveArticle } from '../../kb/articles/archive-article'
import { createArticle } from '../../kb/articles/create-article'
import { updateArticleDraft } from '../../kb/articles/update-article'
import { enqueueKBSync } from '../../kb/kb-sync-queue'
import { computeContentHash } from '../../kb/markdown/hash'
import { mdToBlocks } from '../../kb/markdown/md-to-blocks'
import {
  ensurePathFolders,
  ensureRootFolder,
  findManagedArticle,
  isStructuralExternalId,
  kbCtx,
  listArticlesBySource,
  markPlacementLinked,
} from './article-filing'
import type { SourceSink } from './types'

export const articleSink: SourceSink = {
  async upsertItem(ctx, item) {
    const rootId = await ensureRootFolder(ctx)
    const parentId = await ensurePathFolders(ctx, rootId, item.path)
    const existing = await findManagedArticle(ctx, item.externalId)
    const hash = computeContentHash(item.markdown)
    const contentJson = mdToBlocks(item.markdown)

    let articleId: string
    if (!existing) {
      const created = await createArticle(
        kbCtx(ctx),
        ctx.source.targetKnowledgeBaseId,
        {
          articleKind: 'page',
          parentId,
          title: item.title,
          contentJson,
          managed: true,
          sourceId: ctx.source.id,
          sourceExternalId: item.externalId,
          sourceContentHash: hash,
        },
        ctx.kb.createdById
      )
      await markPlacementLinked(ctx, created.id)
      articleId = created.id
    } else if (!existing.managed) {
      // Detached — the user owns it now; never overwrite.
      return
    } else if (existing.sourceContentHash !== hash) {
      // Content changed at source → overwrite the draft (new draft state; the
      // version-diff surfaces it against the published revision). Bumps the hash.
      await updateArticleDraft(
        kbCtx(ctx),
        existing.id,
        { title: item.title, contentJson, sourceContentHash: hash },
        ctx.kb.createdById,
        ctx.source.targetKnowledgeBaseId
      )
      articleId = existing.id
    } else {
      // Unchanged — still (re)embed to self-heal a missing/disabled Document.
      articleId = existing.id
    }

    await enqueueKBSync({
      type: 'sync-managed',
      articleId,
      kbId: ctx.source.targetKnowledgeBaseId,
      organizationId: ctx.orgId,
    })
  },

  async archiveItem(ctx, externalId) {
    const art = await findManagedArticle(ctx, externalId)
    if (!art?.managed) return // detached or gone — leave it alone
    await archiveArticle(kbCtx(ctx), art.id)
    await enqueueKBSync({
      type: 'unpublish',
      articleId: art.id,
      kbId: ctx.source.targetKnowledgeBaseId,
      organizationId: ctx.orgId,
    })
  },

  async listExisting(ctx) {
    const arts = await listArticlesBySource(ctx)
    return arts
      .filter((a) => !isStructuralExternalId(a.sourceExternalId))
      .map((a) => ({
        externalId: a.sourceExternalId as string,
        contentHash: a.sourceContentHash ?? '',
      }))
  },
}
