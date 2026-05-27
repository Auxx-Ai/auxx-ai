// packages/chat/src/transport/config.ts

import { getApiBase } from '~/shared/runtime-config'

/** Tiptap JSON document. Loose shape — we walk it as a tree and render any
 * leaf with `text` as plain text. `placeholder` nodes carry the visitor-claim
 * id and an encoded `data-fallback` string. */
export interface TiptapNode {
  type?: string
  text?: string
  content?: TiptapNode[]
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

export interface ChatHomeConfig {
  greetingTemplate: TiptapNode | null
  showRecentMessage: boolean
  showSendMessageCta: boolean
  knowledgeBase: {
    siteSlug: string
    siteName: string
    rootArticles: { id: string; title: string; emoji: string | null }[]
  } | null
  featuredArticles: {
    id: string
    title: string
    description: string | null
    emoji: string | null
  }[]
}

export interface ChatConfig {
  channelId: string
  isActive: boolean
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
  home: ChatHomeConfig
  /** Tiptap doc rendered as the synthetic welcome bubble when a thread has
   * zero real messages. Null = the widget shows a hardcoded greeting. */
  welcomeMessageTemplate: TiptapNode | null
  /** Display identity for the bot/agent sender — name/avatar of the
   * configured agent's backing user, or an org-name fallback when no agent
   * is bound (`isOrgFallback: true`). */
  agent: {
    name: string
    avatarUrl: string | null
    isOrgFallback?: boolean
  } | null
  branding: { footerEnabled: boolean }
  allowDownloadTranscript: boolean
  /** Tap-to-send suggestion chips shown above the composer on an empty thread. */
  suggestedReplies: string[]
  /** When non-null, the conversation composer shows a privacy consent banner
   * linking to this URL. Sanitized server-side to http/https only. */
  privacyPolicyUrl: string | null
  /** Server-derived: true when nobody is on chat duty AND the widget has no AI
   * agent bound. Snapshot taken at config-fetch time. When true, the
   * conversation view replaces the composer with `appearance.offlineMessage`. */
  isOffline: boolean
  realtime: { provider: 'pusher'; key: string; cluster: string }
}

export async function fetchChatConfig(
  channelId: string,
  cacheBust: string | null = null
): Promise<ChatConfig> {
  const qs = cacheBust ? `?v=${encodeURIComponent(cacheBust)}` : ''
  const res = await fetch(`${getApiBase()}/api/chat/config/${channelId}${qs}`, {
    method: 'GET',
    credentials: 'omit',
    cache: cacheBust ? 'no-store' : 'default',
  })
  if (!res.ok) throw new Error(`Failed to load chat config (${res.status})`)
  return (await res.json()) as ChatConfig
}
