// apps/api/src/routes/chat/lib.ts

import { database, schema } from '@auxx/database'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Context } from 'hono'

export interface LoadedChatWidget {
  channelId: string
  organizationId: string
  widgetId: string
  isActive: boolean
  integrationEnabled: boolean
  allowedDomains: string[]
  appearance: {
    title: string
    subtitle: string | null
    primaryColor: string
    headerColor: string
    logoLight: string | null
    logoDark: string | null
    position: string
    autoOpen: boolean
    mobileFullScreen: boolean
    collectUserInfo: boolean
    offlineMessage: string | null
    theme: 'light' | 'dark' | 'system'
    primaryColorDark: string | null
    headerColorDark: string | null
  }
  home: {
    greetingTemplate: unknown
    showRecentMessage: boolean
    showSendMessageCta: boolean
    knowledgeBaseId: string | null
    featuredArticleIds: string[]
  }
  branding: {
    footerEnabled: boolean
  }
  allowDownloadTranscript: boolean
  suggestedReplies: string[]
}

/**
 * Loads a chat-widget integration by channel id (= Integration.id). Returns
 * `null` if the integration is missing or not a chat provider.
 *
 * Visitor-facing route: skips the org-cache helper because we don't know the
 * organizationId at call time.
 */
export async function loadChatWidgetByChannelId(
  channelId: string
): Promise<LoadedChatWidget | null> {
  const row = await database.query.Integration.findFirst({
    where: and(eq(schema.Integration.id, channelId), eq(schema.Integration.provider, 'chat')),
    with: { chatWidget: true },
  })
  if (!row?.chatWidget) return null

  return {
    channelId: row.id,
    organizationId: row.organizationId,
    widgetId: row.chatWidget.id,
    isActive: row.chatWidget.isActive,
    integrationEnabled: row.enabled,
    allowedDomains: row.chatWidget.allowedDomains ?? [],
    appearance: {
      title: row.chatWidget.title,
      subtitle: row.chatWidget.subtitle ?? null,
      primaryColor: row.chatWidget.primaryColor,
      headerColor: row.chatWidget.headerColor,
      logoLight: row.chatWidget.logoLight ?? null,
      logoDark: row.chatWidget.logoDark ?? null,
      position: row.chatWidget.position,
      autoOpen: row.chatWidget.autoOpen,
      mobileFullScreen: row.chatWidget.mobileFullScreen,
      collectUserInfo: row.chatWidget.collectUserInfo,
      offlineMessage: row.chatWidget.offlineMessage ?? null,
      theme: (row.chatWidget.defaultTheme ?? 'light') as 'light' | 'dark' | 'system',
      primaryColorDark: row.chatWidget.primaryColorDark ?? null,
      headerColorDark: row.chatWidget.headerColorDark ?? null,
    },
    home: {
      greetingTemplate: row.chatWidget.homeGreetingTemplate ?? null,
      showRecentMessage: row.chatWidget.homeShowRecentMessage,
      showSendMessageCta: row.chatWidget.homeShowSendMessageCta,
      knowledgeBaseId: row.chatWidget.knowledgeBaseId ?? null,
      featuredArticleIds: row.chatWidget.featuredArticleIds ?? [],
    },
    branding: {
      footerEnabled: row.chatWidget.brandingFooterEnabled,
    },
    allowDownloadTranscript: row.chatWidget.allowDownloadTranscript,
    suggestedReplies: (row.chatWidget.suggestedReplies ?? [])
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 5),
  }
}

export interface HomeKnowledgeBaseInfo {
  siteSlug: string
  siteName: string
  rootArticles: { id: string; title: string; emoji: string | null }[]
}

export interface HomeFeaturedArticle {
  id: string
  title: string
  description: string | null
  emoji: string | null
}

/**
 * Resolve the KB site info + top-level published articles for the chat
 * widget's Home tab. Returns `null` when the widget has no linked KB or the
 * KB has been deleted.
 */
export async function loadHomeKnowledgeBase(
  organizationId: string,
  knowledgeBaseId: string | null
): Promise<HomeKnowledgeBaseInfo | null> {
  if (!knowledgeBaseId) return null
  const kb = await database.query.KnowledgeBase.findFirst({
    where: (k, { and: a, eq: e }) =>
      a(e(k.id, knowledgeBaseId), e(k.organizationId, organizationId)),
    columns: { id: true, name: true, slug: true },
  })
  if (!kb) return null

  const articles = await database
    .select({
      id: schema.Article.id,
      title: schema.Article.title,
      emoji: schema.Article.emoji,
    })
    .from(schema.Article)
    .where(
      and(eq(schema.Article.knowledgeBaseId, knowledgeBaseId), eq(schema.Article.isPublished, true))
    )
    .orderBy(asc(schema.Article.sortOrder))

  const rootArticles = articles
    .filter((a) => a.title)
    .map((a) => ({ id: a.id, title: a.title ?? '', emoji: a.emoji ?? null }))

  return { siteSlug: kb.slug, siteName: kb.name, rootArticles }
}

/**
 * Fetch the ordered set of featured articles for the chat widget Home tab.
 * Filters out missing / unpublished entries and preserves the admin-set order.
 */
export async function loadHomeFeaturedArticles(
  organizationId: string,
  featuredArticleIds: string[]
): Promise<HomeFeaturedArticle[]> {
  if (featuredArticleIds.length === 0) return []
  const rows = await database
    .select({
      id: schema.Article.id,
      title: schema.Article.title,
      excerpt: schema.Article.excerpt,
      emoji: schema.Article.emoji,
    })
    .from(schema.Article)
    .where(
      and(
        eq(schema.Article.organizationId, organizationId),
        eq(schema.Article.isPublished, true),
        inArray(schema.Article.id, featuredArticleIds)
      )
    )

  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: HomeFeaturedArticle[] = []
  for (const id of featuredArticleIds) {
    const row = byId.get(id)
    if (!row) continue
    out.push({
      id: row.id,
      title: row.title ?? 'Untitled',
      description: row.excerpt ?? null,
      emoji: row.emoji ?? null,
    })
  }
  return out
}

/** Extract hostname from an Origin/Referer header value, or null. */
export function hostnameFromHeader(value: string | undefined | null): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname
  } catch {
    return null
  }
}

/**
 * Return true if `host` is allowed by `allowedDomains`. An empty allowlist
 * matches everything.
 */
export function isHostAllowed(allowedDomains: string[], host: string | null): boolean {
  if (allowedDomains.length === 0) return true
  if (!host) return false
  return allowedDomains.some((d) => host === d || host.endsWith(`.${d}`))
}

/** Echo the request origin in CORS headers when it's allowed; otherwise wildcard. */
export function applyChatCorsHeaders(c: Context, opts: { allowCredentials: boolean }): void {
  const origin = c.req.header('origin')
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin')
  } else {
    c.header('Access-Control-Allow-Origin', '*')
  }
  c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  if (opts.allowCredentials) {
    c.header('Access-Control-Allow-Credentials', 'true')
  }
}
