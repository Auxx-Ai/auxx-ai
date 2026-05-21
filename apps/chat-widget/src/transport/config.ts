// apps/chat-widget/src/transport/config.ts

export interface ChatConfig {
  channelId: string
  isActive: boolean
  appearance: {
    title: string
    subtitle: string | null
    primaryColor: string
    logoUrl: string | null
    position: string
    welcomeMessage: string | null
    autoOpen: boolean
    mobileFullScreen: boolean
    collectUserInfo: boolean
    offlineMessage: string | null
  }
  realtime: { provider: 'pusher'; key: string; cluster: string }
}

export async function fetchChatConfig(channelId: string): Promise<ChatConfig> {
  const res = await fetch(`${__AUXX_API_BASE_URL__}/api/chat/config/${channelId}`, {
    method: 'GET',
    credentials: 'omit',
  })
  if (!res.ok) throw new Error(`Failed to load chat config (${res.status})`)
  return (await res.json()) as ChatConfig
}
