// apps/kb/src/server/kb-data.ts

import {
  Article,
  ArticlePlacement,
  ArticleRevision,
  database,
  KnowledgeBase,
  Organization,
} from '@auxx/database'
import type { ArticleKind } from '@auxx/database/types'
import { isOrgMember } from '@auxx/lib/cache'
import { MediaAssetService } from '@auxx/lib/files/server'
import type { ArticleNodeJSON, KBLayoutKB } from '@auxx/ui/components/kb'
import { and, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

export interface PublicArticleListItem {
  id: string
  knowledgeBaseId: string
  title: string
  slug: string
  emoji: string | null
  parentId: string | null
  articleKind: ArticleKind
  sortOrder: string
  isPublished: boolean
  description: string | null
  excerpt: string | null
}

export interface PublicArticleFull extends PublicArticleListItem {
  content: string
  contentJson: ArticleNodeJSON[] | null
  coverImage: string | null
  publishedAt: Date | null
  updatedAt: Date
}

export type PublicKB = KBLayoutKB & {
  organizationId: string
  slug: string
  description: string | null
  publishStatus: 'DRAFT' | 'PUBLISHED' | 'UNLISTED'
  visibility: 'PUBLIC' | 'INTERNAL'
  defaultMode: string | null
}

export type AccessDenied = 'unauthenticated' | 'forbidden'

export interface KBVisibilityInfo {
  id: string
  organizationId: string
  visibility: 'PUBLIC' | 'INTERNAL'
  publishStatus: 'DRAFT' | 'PUBLISHED' | 'UNLISTED'
}

// Sentinel used by `generateStaticParams` to satisfy cacheComponents' need for at
// least one stub. The Docker image builds without a database, so any DB call
// during that prerender pass fails with ECONNREFUSED. Short-circuit it here.
const BUILD_STUB = '__build__'
const isBuildStub = (orgSlug: string, kbSlug: string): boolean =>
  orgSlug === BUILD_STUB || kbSlug === BUILD_STUB

/**
 * Lightweight metadata-only lookup for the layout to decide between the
 * cached public path and the auth-gated internal path before doing full
 * payload work. Cheaper than `loadKBPayload` and safe to short-cache when
 * needed by the caller.
 */
export async function getKBVisibility(
  orgSlug: string,
  kbSlug: string
): Promise<KBVisibilityInfo | null> {
  if (isBuildStub(orgSlug, kbSlug)) return null
  const [row] = await database
    .select({
      id: KnowledgeBase.id,
      organizationId: KnowledgeBase.organizationId,
      visibility: KnowledgeBase.visibility,
      publishStatus: KnowledgeBase.publishStatus,
    })
    .from(KnowledgeBase)
    .innerJoin(Organization, eq(Organization.id, KnowledgeBase.organizationId))
    .where(and(eq(Organization.handle, orgSlug), eq(KnowledgeBase.slug, kbSlug)))
    .limit(1)
  return row ?? null
}

/**
 * Hide subtrees whose ancestor is unpublished/archived: filter the loaded set
 * to articles whose entire parentId chain is published. Implemented in JS
 * since per-KB article counts are small.
 */
function filterVisibleSubtree<
  A extends { id: string; parentId: string | null; isPublished: boolean },
>(articles: A[]): A[] {
  const byId = new Map(articles.map((a) => [a.id, a]))
  return articles.filter((a) => {
    let cursor: A | undefined = a
    while (cursor) {
      if (!cursor.isPublished) return false
      if (!cursor.parentId) return true
      cursor = byId.get(cursor.parentId)
      // If the parent isn't in the published set, the chain is broken — exclude.
      if (!cursor) return false
    }
    return true
  })
}

export async function loadKBPayload(
  orgSlug: string,
  kbSlug: string,
  opts?: { session?: { userId: string } | null }
): Promise<{
  kb: PublicKB | null
  articles: PublicArticleListItem[]
  accessDenied?: AccessDenied
}> {
  if (isBuildStub(orgSlug, kbSlug)) return { kb: null, articles: [] }
  const rows = await database
    .select({
      kb: KnowledgeBase,
      orgId: Organization.id,
    })
    .from(KnowledgeBase)
    .innerJoin(Organization, eq(Organization.id, KnowledgeBase.organizationId))
    .where(and(eq(Organization.handle, orgSlug), eq(KnowledgeBase.slug, kbSlug)))
    .limit(1)

  const row = rows[0]
  if (!row) return { kb: null, articles: [] }

  const kb = row.kb
  if (kb.publishStatus === 'DRAFT') return { kb: null, articles: [] }

  if (kb.visibility === 'INTERNAL') {
    if (!opts?.session) return { kb: null, articles: [], accessDenied: 'unauthenticated' }
    const member = await isOrgMember(kb.organizationId, opts.session.userId)
    if (!member) return { kb: null, articles: [], accessDenied: 'forbidden' }
  }

  const pub = alias(ArticleRevision, 'pub')
  const rawPlacements = await database
    .select({
      placementId: ArticlePlacement.id,
      articleId: ArticlePlacement.articleId,
      knowledgeBaseId: ArticlePlacement.knowledgeBaseId,
      slug: ArticlePlacement.slug,
      parentPlacementId: ArticlePlacement.parentId,
      articleKind: Article.articleKind,
      sortOrder: ArticlePlacement.sortOrder,
      isPublished: ArticlePlacement.isPublished,
      title: pub.title,
      emoji: pub.emoji,
      description: pub.description,
      excerpt: pub.excerpt,
    })
    .from(ArticlePlacement)
    .innerJoin(Article, eq(Article.id, ArticlePlacement.articleId))
    .innerJoin(pub, eq(pub.id, ArticlePlacement.publishedRevisionId))
    .where(
      and(
        eq(ArticlePlacement.knowledgeBaseId, kb.id),
        eq(ArticlePlacement.isPublished, true),
        isNull(Article.archivedAt) // archive is article-wide; hide every placement
      )
    )

  // Remap parentId to article-id space so the tree (and filterVisibleSubtree)
  // works exactly as before — the public node id stays the article id.
  const toArticleId = new Map(rawPlacements.map((p) => [p.placementId, p.articleId]))
  const rawArticles: PublicArticleListItem[] = rawPlacements.map((p) => ({
    id: p.articleId,
    knowledgeBaseId: p.knowledgeBaseId,
    title: p.title,
    slug: p.slug,
    emoji: p.emoji,
    parentId: p.parentPlacementId ? (toArticleId.get(p.parentPlacementId) ?? null) : null,
    articleKind: p.articleKind,
    sortOrder: p.sortOrder,
    isPublished: p.isPublished,
    description: p.description,
    excerpt: p.excerpt,
  }))

  const articles = filterVisibleSubtree(rawArticles)

  const publicKB: PublicKB = {
    id: kb.id,
    name: kb.name,
    slug: kb.slug,
    organizationId: kb.organizationId,
    description: kb.description,
    publishStatus: kb.publishStatus,
    visibility: kb.visibility,
    defaultMode: kb.defaultMode,
    showMode: kb.showMode,
    primaryColorLight: kb.primaryColorLight,
    primaryColorDark: kb.primaryColorDark,
    tintColorLight: kb.tintColorLight,
    tintColorDark: kb.tintColorDark,
    infoColorLight: kb.infoColorLight,
    infoColorDark: kb.infoColorDark,
    successColorLight: kb.successColorLight,
    successColorDark: kb.successColorDark,
    warningColorLight: kb.warningColorLight,
    warningColorDark: kb.warningColorDark,
    dangerColorLight: kb.dangerColorLight,
    dangerColorDark: kb.dangerColorDark,
    fontFamily: kb.fontFamily,
    cornerStyle: kb.cornerStyle,
    logoLight: kb.logoLight,
    logoDark: kb.logoDark,
    searchbarPosition: kb.searchbarPosition,
    headerNavigation: kb.headerNavigation,
    footerNavigation: kb.footerNavigation,
    theme: kb.theme,
    sidebarListStyle: kb.sidebarListStyle,
    headerEnabled: kb.headerEnabled,
    footerEnabled: kb.footerEnabled,
  }

  return { kb: publicKB, articles }
}

export async function loadKBPayloadWithContent(
  orgSlug: string,
  kbSlug: string,
  opts?: { session?: { userId: string } | null }
): Promise<{
  kb: PublicKB | null
  articles: PublicArticleFull[]
  accessDenied?: AccessDenied
}> {
  const { kb, accessDenied } = await loadKBPayload(orgSlug, kbSlug, opts)
  if (!kb) return { kb: null, articles: [], accessDenied }

  const pub = alias(ArticleRevision, 'pub')
  const rows = await database
    .select({
      placementId: ArticlePlacement.id,
      articleId: ArticlePlacement.articleId,
      knowledgeBaseId: ArticlePlacement.knowledgeBaseId,
      slug: ArticlePlacement.slug,
      parentPlacementId: ArticlePlacement.parentId,
      articleKind: Article.articleKind,
      sortOrder: ArticlePlacement.sortOrder,
      isPublished: ArticlePlacement.isPublished,
      publishedAt: ArticlePlacement.publishedAt,
      updatedAt: Article.updatedAt,
      pubTitle: pub.title,
      pubEmoji: pub.emoji,
      pubDescription: pub.description,
      pubExcerpt: pub.excerpt,
      pubContent: pub.content,
      pubContentJson: pub.contentJson,
      pubCoverImageId: pub.coverImageId,
    })
    .from(ArticlePlacement)
    .innerJoin(Article, eq(Article.id, ArticlePlacement.articleId))
    .innerJoin(pub, eq(pub.id, ArticlePlacement.publishedRevisionId))
    .where(
      and(
        eq(ArticlePlacement.knowledgeBaseId, kb.id),
        eq(ArticlePlacement.isPublished, true),
        isNull(Article.archivedAt)
      )
    )

  // Resolve cover URLs in a single fan-out so the SSR pass makes
  // O(unique-covers) S3 round-trips instead of O(articles).
  const assetService = new MediaAssetService(kb.organizationId)
  const uniqueCoverIds = Array.from(
    new Set(rows.map((r) => r.pubCoverImageId).filter((id): id is string => !!id))
  )
  const coverUrlEntries = await Promise.all(
    uniqueCoverIds.map(async (id) => {
      try {
        return [id, await assetService.getDownloadUrl(id)] as const
      } catch {
        return [id, null] as const
      }
    })
  )
  const coverUrlMap = new Map(coverUrlEntries)

  const toArticleId = new Map(rows.map((r) => [r.placementId, r.articleId]))
  const fullArticles: PublicArticleFull[] = rows.map((r) => ({
    id: r.articleId,
    knowledgeBaseId: r.knowledgeBaseId,
    title: r.pubTitle,
    slug: r.slug,
    emoji: r.pubEmoji,
    parentId: r.parentPlacementId ? (toArticleId.get(r.parentPlacementId) ?? null) : null,
    articleKind: r.articleKind,
    sortOrder: r.sortOrder,
    isPublished: r.isPublished,
    description: r.pubDescription,
    excerpt: r.pubExcerpt,
    content: r.pubContent,
    contentJson: (r.pubContentJson as ArticleNodeJSON[] | null) ?? null,
    coverImage: r.pubCoverImageId ? (coverUrlMap.get(r.pubCoverImageId) ?? null) : null,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
  }))

  return { kb, articles: filterVisibleSubtree(fullArticles) }
}
