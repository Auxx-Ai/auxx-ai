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

import { ArrowDownLeft, ArrowUpRight, X } from 'lucide-react'
import type { Ref } from 'preact'
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
  resolvedTheme: 'light' | 'dark'
  onClose?: () => void
  floating?: boolean
  onToggleFloating?: () => void
  headerRef?: Ref<HTMLElement>
}

/**
 * Pick a contrast-safe text color (black/white) for a hex background using
 * WCAG relative luminance. Mirrors the simple version of WCAG 2.x §1.4.3:
 * compute luminance of the bg, return white below ~0.5, black otherwise.
 */
function pickContrastText(hex: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#ffffff'
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const toLin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b)
  return lum > 0.5 ? '#000000' : '#ffffff'
}

interface RecentThread {
  id: string
  subject: string | null
  lastMessage: { preview: string; isInbound: boolean; timestamp: string }
}

export function HomeView({
  channelId,
  config,
  resolvedTheme,
  onClose,
  floating = false,
  onToggleFloating,
  headerRef,
}: HomeViewProps) {
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

  const isDark = resolvedTheme === 'dark'
  const headerColor =
    isDark && config.appearance.headerColorDark
      ? config.appearance.headerColorDark
      : config.appearance.headerColor
  const headerText = pickContrastText(headerColor)
  const isLightHeader = headerText === '#000000'
  // In dark mode prefer logoDark (light-surface logo); fall back to logoLight.
  const logo = isDark
    ? (config.appearance.logoDark ?? config.appearance.logoLight)
    : config.appearance.logoLight

  return (
    <div className='relative flex min-h-0 flex-1 flex-col [&>*:last-child]:rounded-b-2xl'>
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-x-0 top-0 z-0 rounded-t-2xl'
        style={{
          height: '200px',
          background: `linear-gradient(to bottom, ${headerColor} 45%, transparent 100%)`,
        }}
      />
      <div
        ref={headerRef}
        className='relative z-10 flex shrink-0 flex-col gap-8 ps-5 pe-3 pt-5 pb-6'
        style={{ color: headerText }}>
        <div className='flex items-start justify-between'>
          {logo ? <img src={logo} alt='' className='h-8 w-auto' /> : <span className='h-8' />}
          <div className='flex items-center gap-1'>
            {onToggleFloating ? (
              <button
                type='button'
                onClick={onToggleFloating}
                onPointerDown={(e) => e.stopPropagation()}
                data-no-drag
                aria-label={floating ? 'Dock chat' : 'Pop out chat'}
                aria-pressed={floating}
                className={
                  isLightHeader
                    ? 'flex size-7 items-center justify-center rounded text-black/70 transition-colors hover:bg-black/5 hover:text-black'
                    : 'flex size-7 items-center justify-center rounded text-white/90 transition-colors hover:bg-white/10 hover:text-white'
                }>
                {floating ? (
                  <ArrowDownLeft className='size-4' aria-hidden='true' />
                ) : (
                  <ArrowUpRight className='size-4' aria-hidden='true' />
                )}
              </button>
            ) : null}
            {onClose ? (
              <button
                type='button'
                onClick={onClose}
                onPointerDown={(e) => e.stopPropagation()}
                data-no-drag
                aria-label='Close chat'
                className={
                  isLightHeader
                    ? 'flex size-7 items-center justify-center rounded text-black/70 transition-colors hover:bg-black/5 hover:text-black'
                    : 'flex size-7 items-center justify-center rounded text-white/90 transition-colors hover:bg-white/10 hover:text-white'
                }>
                <X className='size-4' aria-hidden='true' />
              </button>
            ) : null}
          </div>
        </div>
        <Greeting doc={home.greetingTemplate ?? null} identify={identify} />
      </div>
      <div className='relative z-10 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3'>
        {cards.length === 0 ? (
          <p className='py-6 text-center text-xs text-muted-foreground'>No conversations yet</p>
        ) : (
          cards
        )}
      </div>
      {config.branding.footerEnabled ? (
        <div className='relative z-10 border-t border-border bg-transparent py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground'>
          Powered by Auxx
        </div>
      ) : null}
    </div>
  )
}
