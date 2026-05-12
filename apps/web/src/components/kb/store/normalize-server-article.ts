// apps/web/src/components/kb/store/normalize-server-article.ts
import { ArticleKind, ArticleStatus } from '@auxx/database/enums'
import type { ArticleKind as ArticleKindType } from '@auxx/database/types'
import type { ArticleMeta } from './article-store'

/**
 * Convert a raw tRPC response into a strict {@link ArticleMeta}. Owns every
 * field-level translation the store relies on: Date coercion, nullable
 * defaults, draft/published envelope synthesis for cached responses that
 * predate the envelope rollout, and mirroring `draft.*` onto the top-level
 * display fields so the sidebar reflects the current working state.
 *
 * Every server → store handoff (initial hydration, mutation responses,
 * cross-tab resync) must go through this — the store trusts its writers to
 * hand it a fully-shaped value, so a missing field here surfaces as a
 * runtime crash in a component reading `article.draft.emoji`.
 */
export function normalizeServerArticle(server: any): ArticleMeta {
  const draft: ArticleMeta['draft'] = server.draft ?? {
    title: server.title ?? '',
    description: server.description ?? null,
    excerpt: server.excerpt ?? null,
    emoji: server.emoji ?? null,
    coverImage: server.coverImage ?? null,
    coverImageId: server.coverImageId ?? null,
  }
  const published: ArticleMeta['published'] = server.published ?? null
  return {
    id: server.id,
    knowledgeBaseId: server.knowledgeBaseId,
    title: draft.title,
    slug: server.slug ?? '',
    emoji: draft.emoji,
    parentId: server.parentId ?? null,
    articleKind: (server.articleKind ?? ArticleKind.page) as ArticleKindType,
    sortOrder: server.sortOrder ?? 'a0',
    isPublished: !!server.isPublished,
    aiEnabled: server.aiEnabled ?? true,
    status: (server.status ?? ArticleStatus.DRAFT) as ArticleMeta['status'],
    description: draft.description,
    excerpt: draft.excerpt,
    coverImage: draft.coverImage,
    hasUnpublishedChanges: !!server.hasUnpublishedChanges,
    publishedAt: server.publishedAt ? new Date(server.publishedAt) : null,
    publishedRevisionId: server.publishedRevisionId ?? null,
    draftRevisionId: server.draftRevisionId ?? null,
    draft,
    published,
    tagIds: (server.tagIds ?? []) as ArticleMeta['tagIds'],
  }
}
