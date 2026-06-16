// apps/api/src/routes/chat/lib.ts

import { database, schema } from '@auxx/database'
import { getCachedAgentById, getCachedOrgProfile } from '@auxx/lib/cache'
import type { ChatAttachment } from '@auxx/lib/chat'
import { listOnDutyUserIds } from '@auxx/lib/chat-duty'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Context } from 'hono'

/**
 * Thread lifecycle event types the widget renders as centered system lines.
 *
 * Keep in sync with `apps/chat-widget/src/transport/thread-events.ts` —
 * the union is duplicated rather than imported because the widget cannot
 * pull `@auxx/lib/events` (server deps).
 */
export const WIDGET_THREAD_EVENT_TYPES = [
  'thread:taken_over',
  'thread:returned_to_ai',
  'thread:archived',
  'thread:reopened',
  'thread:assignee:changed',
  'thread:visitor:identified',
] as const

export type WidgetThreadEventType = (typeof WIDGET_THREAD_EVENT_TYPES)[number]

export interface WidgetThreadEvent {
  id: string
  type: WidgetThreadEventType
  createdAt: Date
  data: Record<string, unknown>
}

/** Cap analogous to message history pagination; anonymous chats are short. */
const THREAD_EVENT_LIMIT = 50

/**
 * Fetch the persisted thread lifecycle events for a given thread, org-scoped.
 *
 * Uses the `Event_threadId_expr_idx` expression index on `data->>'threadId'`
 * (added in #664) plus the `Event_type_idx` to narrow to widget-visible types.
 * Returned newest-last so the widget can append in chronological order.
 */
export async function loadThreadEvents(
  organizationId: string,
  threadId: string
): Promise<WidgetThreadEvent[]> {
  const rows = await database
    .select({
      id: schema.Event.id,
      type: schema.Event.type,
      createdAt: schema.Event.createdAt,
      data: schema.Event.data,
    })
    .from(schema.Event)
    .where(
      and(
        eq(schema.Event.organizationId, organizationId),
        inArray(schema.Event.type, [...WIDGET_THREAD_EVENT_TYPES]),
        sql`(${schema.Event.data}->>'threadId') = ${threadId}`
      )
    )
    .orderBy(asc(schema.Event.createdAt))
    .limit(THREAD_EVENT_LIMIT)

  return rows.map((r) => ({
    id: r.id,
    type: r.type as WidgetThreadEventType,
    createdAt: r.createdAt,
    data: (r.data ?? {}) as Record<string, unknown>,
  }))
}

/**
 * Load non-inline attachment metadata for a batch of message ids, grouped by
 * message. Returns metadata only — no presigned URLs. The widget resolves URLs
 * lazily via `GET /api/chat/attachments/:attachmentId/url` per attachment.
 *
 * `role = 'ATTACHMENT'` filter keeps cid-referenced inline images out of the
 * bubble (those are handled separately by the email path).
 *
 * Joins both `MediaAsset` and `FolderFile` because agent-side picks from the
 * file manager produce `Attachment.fileId` rows, while fresh uploads produce
 * `Attachment.assetId` rows. The widget treats the returned `id` as opaque —
 * it's actually `Attachment.id` so the URL endpoint can resolve either backing.
 */
export async function loadChatAttachmentsForMessages(
  organizationId: string,
  messageIds: string[]
): Promise<Map<string, ChatAttachment[]>> {
  if (messageIds.length === 0) return new Map()

  const rows = await database
    .select({
      messageId: schema.Attachment.entityId,
      id: schema.Attachment.id,
      assetName: schema.MediaAsset.name,
      assetMimeType: schema.MediaAsset.mimeType,
      assetSize: schema.MediaAsset.size,
      fileName: schema.FolderFile.name,
      fileMimeType: schema.FolderFile.mimeType,
      fileSize: schema.FolderFile.size,
      title: schema.Attachment.title,
    })
    .from(schema.Attachment)
    .leftJoin(schema.MediaAsset, eq(schema.MediaAsset.id, schema.Attachment.assetId))
    .leftJoin(schema.FolderFile, eq(schema.FolderFile.id, schema.Attachment.fileId))
    .where(
      and(
        eq(schema.Attachment.organizationId, organizationId),
        eq(schema.Attachment.entityType, 'MESSAGE'),
        inArray(schema.Attachment.entityId, messageIds),
        eq(schema.Attachment.role, 'ATTACHMENT')
      )
    )
    .orderBy(asc(schema.Attachment.entityId), asc(schema.Attachment.sort))

  const out = new Map<string, ChatAttachment[]>()
  for (const r of rows) {
    const list = out.get(r.messageId) ?? []
    list.push({
      id: r.id,
      name: r.title ?? r.assetName ?? r.fileName ?? 'attachment',
      mimeType: r.assetMimeType ?? r.fileMimeType ?? 'application/octet-stream',
      size: Number(r.assetSize ?? r.fileSize ?? 0),
    })
    out.set(r.messageId, list)
  }
  return out
}

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
  /** Tiptap doc for the in-conversation welcome bubble. Null = widget falls
   * back to a hardcoded greeting client-side. */
  welcomeMessageTemplate: unknown
  /**
   * Display identity for the bot/agent sender — used by the synthetic welcome
   * bubble and (eventually) for the persisted bubble avatar/name. Resolves to
   * the agent's backing User when `ChatWidget.agentId` is set, otherwise falls
   * back to the org with `isOrgFallback: true` so the widget can swap in a
   * generic avatar.
   */
  agent: {
    name: string
    avatarUrl: string | null
    isOrgFallback?: boolean
  } | null
  branding: {
    footerEnabled: boolean
  }
  allowDownloadTranscript: boolean
  suggestedReplies: string[]
  privacyPolicyUrl: string | null
  /**
   * Per-channel JWT enforcement state (v4 phase 5). Baked into the issued
   * passport so the per-request middleware can decide whether to 401 on a
   * missing/invalid JWT without an extra DB roundtrip.
   */
  identityVerification: 'off' | 'in_progress' | 'enforced'
  /**
   * Channel audience policy (v4 phase 9). Independent of `identityVerification`.
   * - `visitors`: anonymous only — JWT path skipped entirely.
   * - `both`: anonymous + logged-in users — JWT verified when present.
   * - `users`: only logged-in users — mint + writes require a valid JWT when
   *   rollout is `enforced`.
   */
  chatAudience: 'visitors' | 'both' | 'users'
  /**
   * Derived: true when nobody is on chat duty AND the widget has no AI agent
   * bound. In that state the widget renders `appearance.offlineMessage` and
   * disables sending. Snapshotted at config-fetch time — visitors with an open
   * session won't see this flip mid-conversation until they reconnect.
   */
  isOffline: boolean
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

  const agentId = row.chatWidget.agentId ?? null
  const [agent, onDutyUserIds] = await Promise.all([
    resolveAgentIdentity(row.organizationId, agentId),
    listOnDutyUserIds(row.organizationId),
  ])
  const isOffline = agentId === null && onDutyUserIds.length === 0

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
    welcomeMessageTemplate: row.chatWidget.welcomeMessageTemplate ?? null,
    agent,
    branding: {
      footerEnabled: row.chatWidget.brandingFooterEnabled,
    },
    allowDownloadTranscript: row.chatWidget.allowDownloadTranscript,
    suggestedReplies: row.chatWidget.suggestedReplies ?? [],
    privacyPolicyUrl: row.chatWidget.privacyPolicyUrl ?? null,
    identityVerification: row.chatWidget.identityVerification,
    chatAudience: row.chatWidget.chatAudience,
    isOffline,
  }
}

/**
 * Resolve the bot display identity for the widget.
 *
 *  - `agentId` set → look up the cached agent (which already projects the
 *    backing `User.name`/`User.image` into `name`/`avatarUrl` at hydration).
 *  - `agentId` null → fall back to the organization's profile name via the
 *    org cache. There is no `Organization.logo` column today, so `avatarUrl`
 *    is null and the widget renders its built-in placeholder. Marked
 *    `isOrgFallback: true` so downstream UI can differentiate.
 *
 * Both branches read from the org cache — no fresh DB joins on this hot
 * config path.
 */
async function resolveAgentIdentity(
  organizationId: string,
  agentId: string | null
): Promise<LoadedChatWidget['agent']> {
  if (agentId) {
    const cached = await getCachedAgentById(organizationId, agentId)
    if (cached && (cached.name || cached.avatarUrl)) {
      return {
        name: cached.name ?? 'Assistant',
        avatarUrl: cached.avatarUrl ?? null,
      }
    }
    // Fall through to org fallback when the agent is a draft (no name/avatar
    // yet) or no longer in the cache.
  }

  const profile = await getCachedOrgProfile(organizationId)
  return {
    name: profile?.name ?? 'Support',
    avatarUrl: null,
    isOrgFallback: true,
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
      id: schema.ArticlePlacement.articleId,
      title: schema.Article.title,
      emoji: schema.Article.emoji,
    })
    .from(schema.ArticlePlacement)
    .innerJoin(schema.Article, eq(schema.Article.id, schema.ArticlePlacement.articleId))
    .where(
      and(
        eq(schema.ArticlePlacement.knowledgeBaseId, knowledgeBaseId),
        eq(schema.ArticlePlacement.isPublished, true),
        isNull(schema.Article.archivedAt)
      )
    )
    .orderBy(asc(schema.ArticlePlacement.sortOrder))

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
      id: schema.ArticlePlacement.articleId,
      title: schema.Article.title,
      excerpt: schema.Article.excerpt,
      emoji: schema.Article.emoji,
    })
    .from(schema.ArticlePlacement)
    .innerJoin(schema.Article, eq(schema.Article.id, schema.ArticlePlacement.articleId))
    .where(
      and(
        eq(schema.ArticlePlacement.organizationId, organizationId),
        eq(schema.ArticlePlacement.isPublished, true),
        inArray(schema.ArticlePlacement.articleId, featuredArticleIds),
        isNull(schema.Article.archivedAt)
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
 * Resolve the visitor's client IP from the standard proxy headers.
 *
 * In production the load balancer / CDN sets `x-forwarded-for`, so this
 * returns the real public IP that geo lookup + the thread `visit_ip` field
 * depend on. In local dev nothing sets those headers, so the IP — and the
 * MaxMind/ipapi geo lookup keyed off it — is always empty. Set
 * `CHAT_DEV_FAKE_IP` (e.g. `8.8.8.8`) to exercise the full
 * IP → geo → visit-field path with the real widget; the fallback is ignored
 * outside development so it can never leak a spoofed IP into prod.
 */
export function resolveClientIp(c: Context): string | undefined {
  const fromHeader =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || undefined
  if (fromHeader) return fromHeader
  if (process.env.NODE_ENV !== 'production' && process.env.CHAT_DEV_FAKE_IP) {
    return process.env.CHAT_DEV_FAKE_IP
  }
  return undefined
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
