// @auxx/lib/kb/internal/flatten-article.ts
import type { Database, schema, Transaction } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { computeArticleJsonHash } from '../markdown/hash'
import type { ArticleNodeJSON } from '../markdown/types'
import type { ArticleEditorView, ArticleListItem, ArticleRevisionMeta } from '../types'
import { createNotFoundError } from './errors'
import { loadArticleTagRecordIds } from './load-article-tags'
import { loadArticlePlacementRow, toFlattenRow } from './placement'
import { resolveCoverUrls } from './resolve-cover-urls'

type Db = Database | Transaction
type ArticleRevision = typeof schema.ArticleRevision.$inferSelect

/**
 * Cover ids touched by a single article — both draft and published.
 * Used to prime the batch URL map so a single fan-out resolves every
 * cover the list payload needs.
 */
export function coverIdsForArticle(a: {
  draftRevision?: { coverImageId: string | null } | null
  publishedRevision?: { coverImageId: string | null } | null
}): Array<string | null | undefined> {
  return [a.draftRevision?.coverImageId, a.publishedRevision?.coverImageId]
}

/**
 * Build a per-revision envelope (title/emoji/cover…) used by both the
 * sidebar payload and the editor view so draft and published metadata
 * stay structurally identical.
 */
export function buildRevisionMeta(
  rev:
    | {
        title: string | null
        description: string | null
        excerpt: string | null
        emoji: string | null
        coverImageId: string | null
      }
    | null
    | undefined,
  urlMap?: Map<string, string | null>
): ArticleRevisionMeta | null {
  if (!rev) return null
  return {
    title: rev.title ?? '',
    description: rev.description ?? null,
    excerpt: rev.excerpt ?? null,
    emoji: rev.emoji ?? null,
    coverImageId: rev.coverImageId ?? null,
    coverImage: rev.coverImageId ? (urlMap?.get(rev.coverImageId) ?? null) : null,
  }
}

export async function flattenForList(
  db: Db,
  organizationId: string,
  a: any,
  tagIds: RecordId[] = [],
  urlMap?: Map<string, string | null>
): Promise<ArticleListItem> {
  const resolved = urlMap ?? (await resolveCoverUrls(db, organizationId, coverIdsForArticle(a)))
  const draft = buildRevisionMeta(a.draftRevision, resolved) ?? {
    title: '',
    description: null,
    excerpt: null,
    emoji: null,
    coverImage: null,
    coverImageId: null,
  }
  const published = buildRevisionMeta(a.publishedRevision, resolved)
  return {
    id: a.id,
    knowledgeBaseId: a.knowledgeBaseId,
    placementId: a.placementId,
    organizationId: a.organizationId,
    slug: a.slug,
    parentId: a.parentId,
    sortOrder: a.sortOrder,
    articleKind: a.articleKind,
    isPublished: a.isPublished,
    aiEnabled: a.aiEnabled ?? true,
    status: a.status,
    hasUnpublishedChanges: a.hasUnpublishedChanges,
    publishedAt: a.publishedAt,
    publishedRevisionId: a.publishedRevisionId,
    draftRevisionId: a.draftRevisionId,
    placements: a.placements,
    // Sidebar reflects the current working state — always the draft.
    title: draft.title,
    emoji: draft.emoji,
    description: draft.description,
    excerpt: draft.excerpt,
    coverImage: draft.coverImage,
    draft,
    published,
    tagIds,
  }
}

export async function flattenForEditor(
  db: Db,
  organizationId: string,
  a: any,
  selected: ArticleRevision | null = null,
  tagIds: RecordId[] = []
): Promise<ArticleEditorView> {
  const draft = a.draftRevision
  const pub = a.publishedRevision
  if (!draft) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Article ${a.id} has no draft revision`,
    })
  }
  const urlMap = await resolveCoverUrls(db, organizationId, [
    draft.coverImageId,
    pub?.coverImageId,
    selected?.coverImageId,
  ])
  const draftMeta = buildRevisionMeta(draft, urlMap)!
  const publishedMeta = buildRevisionMeta(pub, urlMap)
  return {
    id: a.id,
    knowledgeBaseId: a.knowledgeBaseId,
    placementId: a.placementId,
    organizationId: a.organizationId,
    slug: a.slug,
    parentId: a.parentId,
    sortOrder: a.sortOrder,
    articleKind: a.articleKind,
    isPublished: a.isPublished,
    aiEnabled: a.aiEnabled ?? true,
    status: a.status,
    hasUnpublishedChanges: a.hasUnpublishedChanges,
    publishedAt: a.publishedAt,
    publishedRevisionId: a.publishedRevisionId,
    draftRevisionId: a.draftRevisionId,
    placements: a.placements,
    title: draftMeta.title,
    emoji: draftMeta.emoji,
    description: draftMeta.description,
    excerpt: draftMeta.excerpt,
    coverImage: draftMeta.coverImage,
    coverImageId: draftMeta.coverImageId,
    draft: draftMeta,
    published: publishedMeta,
    tagIds,
    content: draft.content ?? '',
    contentJson: (draft.contentJson as ArticleNodeJSON[] | null) ?? null,
    draftContentHash: computeArticleJsonHash(
      (draft.contentJson as ArticleNodeJSON[] | null) ?? null
    ),
    hasPublishedVersion: !!pub,
    publishedTitle: pub?.title ?? null,
    publishedContent: pub?.content ?? null,
    publishedContentJson: (pub?.contentJson as ArticleNodeJSON[] | null) ?? null,
    publishedCoverImage: pub?.coverImageId ? (urlMap.get(pub.coverImageId) ?? null) : null,
    selectedVersionNumber: selected?.versionNumber ?? null,
    selectedTitle: selected?.title ?? null,
    selectedDescription: selected?.description ?? null,
    selectedExcerpt: selected?.excerpt ?? null,
    selectedEmoji: selected?.emoji ?? null,
    selectedContent: selected?.content ?? null,
    selectedContentJson: (selected?.contentJson as ArticleNodeJSON[] | null) ?? null,
    selectedContentHash: selected
      ? computeArticleJsonHash((selected.contentJson as ArticleNodeJSON[] | null) ?? null)
      : null,
    selectedCoverImage: selected?.coverImageId ? (urlMap.get(selected.coverImageId) ?? null) : null,
    selectedCoverImageId: selected?.coverImageId ?? null,
  }
}

/**
 * Re-query the article + a placement and return the flat list-shape.
 * `knowledgeBaseId` picks the placement; omitted → the article's home placement.
 */
export async function reloadFlat(
  db: Db,
  organizationId: string,
  id: string,
  knowledgeBaseId?: string
): Promise<ArticleListItem> {
  const loaded = await loadArticlePlacementRow(db, organizationId, id, knowledgeBaseId)
  if (!loaded) throw createNotFoundError(`Article with ID '${id}' not found`)
  const tagIds = await loadArticleTagRecordIds(db, organizationId, id)
  const row = toFlattenRow(loaded.article, loaded.placement, {
    parentArticleId: loaded.parentArticleId,
  })
  return await flattenForList(db, organizationId, row, tagIds)
}
