// apps/chat-widget/src/widget.tsx
//
// Outer pillbox shell + tab router. The shell handles open/closed animation
// and the trigger button. Inside, a `useTabRouter` selects which tab's stack
// is active and renders the matching frame. Phase 6 will re-introduce the
// chat-session/Pusher wiring inside ThreadView.

import { useEffect, useState } from 'preact/hooks'
import { FrameHeader, type FrameHeaderVariant } from './components/frame-header'
import { TabBar } from './components/tab-bar'
import { NavStackProvider } from './navigation/nav-stack-context'
import type { NavFrame, NavView } from './navigation/use-navigation-stack'
import { type TabId, useTabRouter } from './navigation/use-tab-router'
import { type ChatConfig, fetchChatConfig } from './transport/config'
import { HomeView } from './views/home/home-view'
import { KbArticleView } from './views/kb/kb-article-view'
import { KbSectionView } from './views/kb/kb-section-view'
import { MessagesView, ThreadView } from './views/placeholder'

interface WidgetProps {
  channelId: string
}

export function Widget({ channelId }: WidgetProps) {
  const [config, setConfig] = useState<ChatConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const router = useTabRouter(channelId)

  useEffect(() => {
    fetchChatConfig(channelId)
      .then((c) => {
        setConfig(c)
        if (c.appearance.autoOpen) setOpen(true)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load chat'))
  }, [channelId])

  if (!config) return null

  const positionClass = config.appearance.position.toLowerCase().includes('left')
    ? 'auxx-chat-shell--bottom-left'
    : 'auxx-chat-shell--bottom-right'
  const stateClass = open ? 'auxx-chat-shell--open' : 'auxx-chat-shell--closed'
  const rootStyle = { '--auxx-chat-primary': config.appearance.primaryColor } as Record<
    string,
    string
  >

  return (
    <div className='auxx-chat-root' style={rootStyle}>
      <div className={`auxx-chat-shell ${stateClass} ${positionClass}`}>
        <button
          type='button'
          className='auxx-chat-shell__trigger'
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close chat' : 'Open chat'}
          aria-expanded={open}
          tabIndex={open ? -1 : 0}
        />
        <span className='auxx-chat-shell__icon' aria-hidden='true'>
          <svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>
            <path d='M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2z' />
          </svg>
        </span>
        <div
          className='auxx-chat-shell__panel'
          role='dialog'
          aria-modal='false'
          aria-label={config.appearance.title}
          aria-hidden={!open}>
          <NavStackProvider value={router.currentStack}>
            <PanelShell
              channelId={channelId}
              config={config}
              activeTab={router.activeTab}
              onTabChange={router.setActiveTab}
              currentFrame={router.currentStack.current}
              isAtRoot={router.currentStack.isAtRoot}
              onBack={router.currentStack.pop}
              onClose={() => setOpen(false)}
              error={error}
            />
          </NavStackProvider>
        </div>
      </div>
    </div>
  )
}

interface PanelShellProps {
  channelId: string
  config: ChatConfig
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  currentFrame: NavFrame | null
  isAtRoot: boolean
  onBack: () => void
  onClose: () => void
  error: string | null
}

function PanelShell({
  channelId,
  config,
  activeTab,
  onTabChange,
  currentFrame,
  isAtRoot,
  onBack,
  onClose,
  error,
}: PanelShellProps) {
  const view: NavView = currentFrame?.view ?? activeTab
  const headerVariant = pickHeaderVariant(view, isAtRoot)

  return (
    <div className='flex h-full flex-col'>
      <FrameHeader
        variant={headerVariant}
        title={headerTitle(view, currentFrame, config)}
        subtitle={
          view === 'home' && isAtRoot ? (config.appearance.subtitle ?? undefined) : undefined
        }
        logoUrl={config.appearance.logoUrl}
        onBack={isAtRoot ? undefined : onBack}
        onClose={onClose}
      />
      {error ? (
        <div className='auxx-chat-error' role='alert'>
          {error}
        </div>
      ) : null}
      <div className='flex min-h-0 flex-1 flex-col bg-[color:var(--color-bg)]'>
        {renderFrame(view, currentFrame, channelId, config)}
      </div>
      {isAtRoot ? <TabBar activeTab={activeTab} onChange={onTabChange} /> : null}
    </div>
  )
}

function pickHeaderVariant(view: NavView, isAtRoot: boolean): FrameHeaderVariant {
  if (!isAtRoot) return 'contextual'
  if (view === 'home') return 'dark-hero'
  return 'plain'
}

function headerTitle(view: NavView, frame: NavFrame | null, config: ChatConfig): string {
  if (frame) return frame.label
  if (view === 'home') return config.appearance.title
  if (view === 'messages') return 'Messages'
  return ''
}

function renderFrame(view: NavView, frame: NavFrame | null, channelId: string, config: ChatConfig) {
  const label = frame?.label ?? ''
  switch (view) {
    case 'home':
      return <HomeView channelId={channelId} config={config} />
    case 'messages':
      return <MessagesView />
    case 'thread':
      return <ThreadView label={label} />
    case 'kb-section': {
      const raw = frame?.params?.sectionId
      const sectionId = typeof raw === 'string' ? raw : null
      return <KbSectionView channelId={channelId} sectionId={sectionId} />
    }
    case 'kb-article': {
      const raw = frame?.params?.articleId
      if (typeof raw !== 'string') return null
      return <KbArticleView channelId={channelId} articleId={raw} />
    }
  }
}
