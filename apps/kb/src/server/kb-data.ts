// apps/kb/src/server/kb-data.ts

import { Article, ArticleRevision, database, KnowledgeBase, Organization } from '@auxx/database'
import { isOrgMember } from '@auxx/lib/cache'
import type { DocJSON, KBLayoutKB } from '@auxx/ui/components/kb'
import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

export interface PublicArticleListItem {
  id: string
  knowledgeBaseId: string
  title: string
  slug: string
  emoji: string | null
  parentId: string | null
  isCategory: boolean
  order: number
  isPublished: boolean
  isHomePage: boolean
  description: string | null
  excerpt: string | null
}

export interface PublicArticleFull extends PublicArticleListItem {
  content: string
  contentJson: DocJSON | null
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
  const rawArticles = await database
    .select({
      id: Article.id,
      knowledgeBaseId: Article.knowledgeBaseId,
      slug: Article.slug,
      parentId: Article.parentId,
      isCategory: Article.isCategory,
      order: Article.order,
      isPublished: Article.isPublished,
      isHomePage: Article.isHomePage,
      title: pub.title,
      emoji: pub.emoji,
      description: pub.description,
      excerpt: pub.excerpt,
    })
    .from(Article)
    .innerJoin(pub, eq(pub.id, Article.publishedRevisionId))
    .where(and(eq(Article.knowledgeBaseId, kb.id), eq(Article.isPublished, true)))

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
      article: Article,
      pubTitle: pub.title,
      pubEmoji: pub.emoji,
      pubDescription: pub.description,
      pubExcerpt: pub.excerpt,
      pubContent: pub.content,
      pubContentJson: pub.contentJson,
    })
    .from(Article)
    .innerJoin(pub, eq(pub.id, Article.publishedRevisionId))
    .where(and(eq(Article.knowledgeBaseId, kb.id), eq(Article.isPublished, true)))

  const fullArticles: PublicArticleFull[] = rows.map((r) => ({
    id: r.article.id,
    knowledgeBaseId: r.article.knowledgeBaseId,
    title: r.pubTitle,
    slug: r.article.slug,
    emoji: r.pubEmoji,
    parentId: r.article.parentId,
    isCategory: r.article.isCategory,
    order: r.article.order,
    isPublished: r.article.isPublished,
    isHomePage: r.article.isHomePage,
    description: r.pubDescription,
    excerpt: r.pubExcerpt,
    content: r.pubContent,
    contentJson: (r.pubContentJson as DocJSON | null) ?? null,
    publishedAt: r.article.publishedAt,
    updatedAt: r.article.updatedAt,
  }))

  return { kb, articles: filterVisibleSubtree(fullArticles) }
}
