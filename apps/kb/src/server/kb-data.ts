// apps/kb/src/server/kb-data.ts

import { Article, database, KnowledgeBase, Organization } from '@auxx/database'
import type { DocJSON, KBLayoutKB } from '@auxx/ui/components/kb'
import { and, eq } from 'drizzle-orm'

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
  isPublic: boolean
  defaultMode: string | null
}

export async function loadKBPayload(
  orgSlug: string,
  kbSlug: string
): Promise<{
  kb: PublicKB | null
  articles: PublicArticleListItem[]
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
  if (!kb.isPublic) return { kb: null, articles: [] }

  const articles = await database
    .select({
      id: Article.id,
      knowledgeBaseId: Article.knowledgeBaseId,
      title: Article.title,
      slug: Article.slug,
      emoji: Article.emoji,
      parentId: Article.parentId,
      isCategory: Article.isCategory,
      order: Article.order,
      isPublished: Article.isPublished,
      description: Article.description,
      excerpt: Article.excerpt,
    })
    .from(Article)
    .where(and(eq(Article.knowledgeBaseId, kb.id), eq(Article.isPublished, true)))

  const publicKB: PublicKB = {
    id: kb.id,
    name: kb.name,
    slug: kb.slug,
    organizationId: kb.organizationId,
    description: kb.description,
    isPublic: kb.isPublic,
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
  kbSlug: string
): Promise<{ kb: PublicKB | null; articles: PublicArticleFull[] }> {
  const { kb } = await loadKBPayload(orgSlug, kbSlug)
  if (!kb) return { kb: null, articles: [] }

  const rows = await database
    .select()
    .from(Article)
    .where(and(eq(Article.knowledgeBaseId, kb.id), eq(Article.isPublished, true)))

  const articles: PublicArticleFull[] = rows.map((a) => ({
    id: a.id,
    knowledgeBaseId: a.knowledgeBaseId,
    title: a.title,
    slug: a.slug,
    emoji: a.emoji,
    parentId: a.parentId,
    isCategory: a.isCategory,
    order: a.order,
    isPublished: a.isPublished,
    description: a.description,
    excerpt: a.excerpt,
    content: a.content,
    contentJson: (a.contentJson as DocJSON | null) ?? null,
    publishedAt: a.publishedAt,
    updatedAt: a.updatedAt,
  }))

  return { kb, articles }
}
