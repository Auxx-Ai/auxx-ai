// apps/chat-widget/src/transport/config.ts

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
  branding: { footerEnabled: boolean }
  allowDownloadTranscript: boolean
  realtime: { provider: 'pusher'; key: string; cluster: string }
}

export async function fetchChatConfig(
  channelId: string,
  cacheBust: string | null = null
): Promise<ChatConfig> {
  const qs = cacheBust ? `?v=${encodeURIComponent(cacheBust)}` : ''
  const res = await fetch(`${__AUXX_API_BASE_URL__}/api/chat/config/${channelId}${qs}`, {
    method: 'GET',
    credentials: 'omit',
    cache: cacheBust ? 'no-store' : 'default',
  })
  if (!res.ok) throw new Error(`Failed to load chat config (${res.status})`)
  return (await res.json()) as ChatConfig
}
