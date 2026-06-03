// packages/lib/src/knowledge-sources/sinks/article-filing.ts
// Placement-aware filing helpers for the article sink: the source's root category
// folder, folder-by-path nesting, and lookups by stable external id. All writes go
// through the placement-based createArticle so the tree/publish model stays uniform.

import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { createArticle } from '../../kb/articles/create-article'
import type { KBContext } from '../../kb/types'
import type { SyncCtx } from './types'

/**
 * Structural nodes (the source root + path folders) use a `__`-prefixed
 * sourceExternalId so they're never confused with real content items during
 * orphan reconciliation (`listExisting` filters them out).
 */
const ROOT_KEY = (sourceId: string) => `__root:${sourceId}`
const FOLDER_KEY = (path: string) => `__folder:${path}`

export const kbCtx = (ctx: SyncCtx): KBContext => ({ db: ctx.db, organizationId: ctx.orgId })

/** Find a managed Article owned by this source by its stable external id. */
export async function findManagedArticle(ctx: SyncCtx, externalId: string) {
  const row = await ctx.db.query.Article.findFirst({
    where: and(
      eq(schema.Article.organizationId, ctx.orgId),
      eq(schema.Article.sourceId, ctx.source.id),
      eq(schema.Article.sourceExternalId, externalId)
    ),
    columns: { id: true, managed: true, sourceContentHash: true, sourceExternalId: true },
  })
  return row ?? null
}

/** All Articles owned by this source (items + structural folders). */
export async function listArticlesBySource(ctx: SyncCtx) {
  return ctx.db.query.Article.findMany({
    where: and(
      eq(schema.Article.organizationId, ctx.orgId),
      eq(schema.Article.sourceId, ctx.source.id)
    ),
    columns: { id: true, managed: true, sourceExternalId: true, sourceContentHash: true },
  })
}

/** Mark an article's home placement in the owned source-KB as a live source link. */
export async function markPlacementLinked(ctx: SyncCtx, articleId: string) {
  await ctx.db
    .update(schema.ArticlePlacement)
    .set({ linkedFromSourceId: ctx.source.id, updatedAt: new Date() })
    .where(
      and(
        eq(schema.ArticlePlacement.articleId, articleId),
        eq(schema.ArticlePlacement.knowledgeBaseId, ctx.kb.id)
      )
    )
}

/** Ensure the source's root category folder exists; returns its article id. */
export async function ensureRootFolder(ctx: SyncCtx): Promise<string> {
  if (ctx.source.rootFolderArticleId) {
    const existing = await ctx.db.query.Article.findFirst({
      where: and(
        eq(schema.Article.id, ctx.source.rootFolderArticleId),
        eq(schema.Article.organizationId, ctx.orgId)
      ),
      columns: { id: true },
    })
    if (existing) return existing.id
  }

  const root = await createArticle(
    kbCtx(ctx),
    ctx.kb.id,
    {
      articleKind: 'category',
      title: ctx.source.name,
      managed: true,
      sourceId: ctx.source.id,
      sourceExternalId: ROOT_KEY(ctx.source.id),
    },
    ctx.kb.createdById
  )
  await markPlacementLinked(ctx, root.id)
  await ctx.db
    .update(schema.KnowledgeSource)
    .set({ rootFolderArticleId: root.id, updatedAt: new Date() })
    .where(eq(schema.KnowledgeSource.id, ctx.source.id))
  // Keep the in-memory source in sync for the rest of this run.
  ctx.source.rootFolderArticleId = root.id
  return root.id
}

/**
 * Walk a path's intermediate segments under the root, creating managed category
 * folders as needed; returns the leaf item's parent article id. No path (manual /
 * file sources) → flat under the root.
 */
export async function ensurePathFolders(
  ctx: SyncCtx,
  rootArticleId: string,
  path?: string
): Promise<string> {
  if (!path) return rootArticleId
  const segments = path.split('/').filter(Boolean)
  segments.pop() // drop the leaf — only intermediate dirs become folders
  if (segments.length === 0) return rootArticleId

  let parentId = rootArticleId
  let acc = ''
  for (const segment of segments) {
    acc += `/${segment}`
    const key = FOLDER_KEY(acc)
    const existing = await findManagedArticle(ctx, key)
    if (existing) {
      parentId = existing.id
      continue
    }
    const folder = await createArticle(
      kbCtx(ctx),
      ctx.kb.id,
      {
        articleKind: 'category',
        title: segment,
        parentId,
        managed: true,
        sourceId: ctx.source.id,
        sourceExternalId: key,
      },
      ctx.kb.createdById
    )
    await markPlacementLinked(ctx, folder.id)
    parentId = folder.id
  }
  return parentId
}

/** True for structural nodes (root/folders) — excluded from item reconciliation. */
export const isStructuralExternalId = (externalId: string | null): boolean =>
  !externalId || externalId.startsWith('__')
