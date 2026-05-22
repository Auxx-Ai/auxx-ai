// apps/chat-widget/src/views/home/home-view.tsx
//
// Home tab root view. Renders the greeting hero + a card stack:
//   1. RecentMessageCard — when the visitor has any thread on this channel
//   2. SendMessageCard   — always (when admin-enabled), creates a fresh thread
//   3. ArticleCard[]     — featured articles, in admin-set order
//   4. BrowseAllCard     — links into the KB section root
//
// Greeting + card visibility are driven by `config.home`. Identify claims
// substitute into the greeting via the Tiptap-JSON walker in ./greeting.

import { useCallback, useEffect, useState } from 'preact/hooks'
import { getStoredIdentify, type IdentifyPayload, onIdentify } from '~/identify'
import { useNavStack } from '~/navigation/nav-stack-context'
import { chatApi } from '~/transport/chat-api'
import type { ChatConfig } from '~/transport/config'
import { ArticleCard } from './cards/article-card'
import { BrowseAllCard } from './cards/browse-all-card'
import { RecentMessageCard } from './cards/recent-message-card'
import { SendMessageCard } from './cards/send-message-card'
import { Greeting } from './greeting'

interface HomeViewProps {
  channelId: string
  config: ChatConfig
}

interface RecentThread {
  id: string
  subject: string | null
  lastMessage: { preview: string; isInbound: boolean; timestamp: string }
}

export function HomeView({ channelId, config }: HomeViewProps) {
  const nav = useNavStack()
  const [identify, setIdentify] = useState<IdentifyPayload | null>(() =>
    getStoredIdentify(channelId)
  )
  const [recent, setRecent] = useState<RecentThread | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => onIdentify((p) => setIdentify(p)), [])

  const api = chatApi(channelId)
  const { home } = config

  // Load recent thread for the card. We only do this when the admin enabled
  // the card; otherwise the API call is wasted.
  useEffect(() => {
    if (!home.showRecentMessage) {
      setRecent(null)
      return
    }
    let cancelled = false
    api
      .getRecentThread()
      .then((data) => {
        if (!cancelled) setRecent(data.thread)
      })
      .catch(() => {
        if (!cancelled) setRecent(null)
      })
    return () => {
      cancelled = true
    }
  }, [home.showRecentMessage])

  const openThread = useCallback(
    (threadId: string, label: string) => {
      nav.push({ id: threadId, label, view: 'thread', params: { threadId } })
    },
    [nav]
  )

  const handleSendMessage = useCallback(async () => {
    setCreating(true)
    try {
      // Reuse the visitor's existing thread if one exists — a single ongoing
      // conversation rather than a new thread per click. `recent` is already
      // loaded when the admin enabled the Recent card; otherwise fetch on
      // demand.
      const existing = recent ?? (await api.getRecentThread().catch(() => null))?.thread ?? null
      if (existing) {
        openThread(existing.id, existing.subject || 'Conversation')
        return
      }
      const { threadId } = await api.createThread({
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      })
      openThread(threadId, 'New conversation')
    } catch {
      // Surface via the existing global error band — keep silent here.
    } finally {
      setCreating(false)
    }
  }, [api, openThread, recent])

  const cards = [
    home.showRecentMessage && recent ? (
      <RecentMessageCard
        key='recent'
        subject={recent.subject}
        preview={recent.lastMessage.preview}
        isInbound={recent.lastMessage.isInbound}
        timestamp={recent.lastMessage.timestamp}
        onOpen={() => openThread(recent.id, recent.subject || 'Conversation')}
      />
    ) : null,
    home.showSendMessageCta ? (
      <SendMessageCard key='send' onClick={handleSendMessage} isPending={creating} />
    ) : null,
    ...home.featuredArticles.map((a) => (
      <ArticleCard
        key={a.id}
        title={a.title}
        description={a.description}
        emoji={a.emoji}
        onClick={() =>
          nav.push({ id: a.id, label: a.title, view: 'kb-article', params: { articleId: a.id } })
        }
      />
    )),
    home.knowledgeBase ? (
      <BrowseAllCard
        key='browse'
        siteName={home.knowledgeBase.siteName}
        onClick={() =>
          nav.push({
            id: 'kb-root',
            label: home.knowledgeBase!.siteName,
            view: 'kb-section',
            params: { sectionId: null },
          })
        }
      />
    ) : null,
  ].filter(Boolean)

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex flex-col gap-1 px-5 pb-4 -mt-2 text-[color:var(--color-primary-foreground)]'>
        <Greeting
          doc={home.greetingTemplate ?? null}
          fallbackText={config.appearance.welcomeMessage}
          identify={identify}
        />
      </div>
      <div className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-[color:var(--color-surface)] p-3'>
        {cards.length === 0 ? (
          <p className='py-6 text-center text-xs text-[color:var(--color-muted)]'>
            No conversations yet
          </p>
        ) : (
          cards
        )}
      </div>
      {config.branding.footerEnabled ? (
        <div className='border-t border-[color:var(--color-border)] bg-[color:var(--color-bg)] py-2 text-center text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]'>
          Powered by Auxx
        </div>
      ) : null}
    </div>
  )
}
