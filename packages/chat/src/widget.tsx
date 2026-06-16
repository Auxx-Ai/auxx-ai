// packages/chat/src/widget.tsx
//
// Outer pillbox shell + tab router. The shell handles open/closed animation
// and the trigger button. Inside, a `useTabRouter` selects which tab's stack
// is active and renders the matching frame.
//
// As of Phase 6 the shell also:
//   - subscribes to the per-visitor Pusher channel as soon as the passport is
//     issued, so the launcher unread badge updates while closed.
//   - tracks an `expanded` state per channel for the wide-window mode.

import type { Ref } from 'preact'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { FrameHeader, type FrameHeaderVariant } from './components/frame-header'
import { FrameTransition, type SlideDirection } from './components/frame-transition'
import { TabBar } from './components/tab-bar'
import { NavStackProvider } from './navigation/nav-stack-context'
import type { NavFrame, NavView } from './navigation/use-navigation-stack'
import { type TabId, useTabRouter } from './navigation/use-tab-router'
import { getLastReadAt } from './persistence/unread'
import { useShadowRoot } from './shadow-root'
import {
  getPreviewBypassAudience,
  getPreviewRounded,
  getStartOpen,
  getUserJwt,
} from './shared/runtime-config'
import { hexToOklchHue } from './theme/hex-to-oklch-hue'
import { useResolvedTheme } from './theme/use-resolved-theme'
import { chatApi } from './transport/chat-api'
import { type ChatConfig, fetchChatConfig } from './transport/config'
import {
  connectVisitorChannel,
  type ThreadCreatedEvent,
  type ThreadUpdatedEvent,
} from './transport/visitor-channel'
import { ConversationView } from './views/conversation/conversation-view'
import { ConversationMenu } from './views/conversation/menu'
import { HomeView } from './views/home/home-view'
import { KbArticleView } from './views/kb/kb-article-view'
import { KbSectionView } from './views/kb/kb-section-view'
import { MessagesView } from './views/messages/messages-view'
import { clampToViewport, useDragShell } from './views/use-drag-shell'

interface WidgetProps {
  channelId: string
  cacheBust?: string | null
  scriptTheme?: 'light' | 'dark' | 'system'
}

const EXPANDED_PREFIX = 'auxx-chat-expanded:'

const TAB_ORDER: TabId[] = ['home', 'messages', 'help']

interface NavSignature {
  activeTab: TabId
  stackLength: number
  currentId: string | null
}

// Picks the slide direction for the next FrameTransition swap by diffing the
// previous nav signature against the current one. Tab swaps use TAB_ORDER to
// determine which side the new tab slides in from; stack pushes always slide
// in from the right, pops from the left. Same-stack-length identity changes
// (replace) are treated as a forward slide.
function useTransitionDirection(signature: NavSignature): SlideDirection {
  const prevRef = useRef<NavSignature>(signature)
  let direction: SlideDirection = 'from-right'
  const prev = prevRef.current
  if (prev.activeTab !== signature.activeTab) {
    const prevIdx = TAB_ORDER.indexOf(prev.activeTab)
    const nextIdx = TAB_ORDER.indexOf(signature.activeTab)
    direction = nextIdx > prevIdx ? 'from-right' : 'from-left'
  } else if (signature.stackLength < prev.stackLength) {
    direction = 'from-left'
  }
  useLayoutEffect(() => {
    prevRef.current = signature
  })
  return direction
}

function readExpanded(channelId: string): boolean {
  try {
    return window.localStorage.getItem(`${EXPANDED_PREFIX}${channelId}`) === '1'
  } catch {
    return false
  }
}

function writeExpanded(channelId: string, expanded: boolean): void {
  try {
    window.localStorage.setItem(`${EXPANDED_PREFIX}${channelId}`, expanded ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function Widget({ channelId, cacheBust = null, scriptTheme }: WidgetProps) {
  const [config, setConfig] = useState<ChatConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  // `expanded` is the visual state; the user's sticky preference lives in
  // localStorage. Start collapsed — the per-thread effect below restores the
  // preference whenever the visitor enters a thread.
  const [expanded, setExpanded] = useState(false)
  // `floatPosition` is in-memory only. null = docked. Closing the widget or
  // reloading the page resets to docked.
  const [floatPosition, setFloatPosition] = useState<{ x: number; y: number } | null>(null)
  // Track both elements as state so the drag effect re-runs when either swaps
  // — the active header element changes as the visitor navigates views
  // (contextual ↔ plain ↔ dark-hero ↔ home div).
  const [shellEl, setShellEl] = useState<HTMLDivElement | null>(null)
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null)
  const shellRefCallback = useCallback((el: HTMLDivElement | null) => {
    setShellEl(el)
  }, [])
  // Multiple PanelShells share this callback during a frame transition (the
  // exiting + entering layers both render a header). On mount, the latest
  // header wins. On unmount, the callback fires with `null` — but we can't
  // tell which element triggered it. Only clear if the currently-tracked
  // header is no longer in the DOM; otherwise the entering layer's freshly
  // set ref would get clobbered when the exiting layer tears down.
  const headerRefCallback = useCallback((el: HTMLElement | null) => {
    if (el) {
      setHeaderEl(el)
    } else {
      setHeaderEl((current) => (current && current.isConnected ? current : null))
    }
  }, [])

  const shadowRoot = useShadowRoot()
  const resolvedTheme = useResolvedTheme({
    scriptTheme,
    adminTheme: config?.appearance.theme ?? 'light',
  })

  // Apply data-theme + brand custom properties to the .auxx-root element
  // inside the shadow root.
  //
  // Why brand vars must live on `.auxx-root`, not the JSX `.auxx-chat-root`
  // below: unregistered custom properties substitute their `var()` references
  // at *declaration* time, not at use time. Every derived token
  // (`--primary`, `--auxx-chat-primary-band`, glass overlay, loud, raised,
  // shadow tints) is declared on `.auxx-root` in styles.css and references
  // `--auxx-chat-primary` / `--auxx-chat-tint-h`. If those inputs are only
  // set inline on a descendant, the derived tokens resolve against the
  // defaults on `.auxx-root` and descendants inherit the already-frozen
  // (defaulted) values. Setting the inputs on `.auxx-root` itself fixes the
  // whole derivation chain.
  const tintHue = config
    ? hexToOklchHue(config.appearance.primaryColorDark ?? config.appearance.primaryColor)
    : null
  const primaryColor = config?.appearance.primaryColor ?? null
  const primaryColorDark = config?.appearance.primaryColorDark ?? null
  const headerColor = config?.appearance.headerColor ?? null
  const headerColorDark = config?.appearance.headerColorDark ?? null
  useEffect(() => {
    const rootEl = shadowRoot?.querySelector('.auxx-root') as HTMLElement | null
    if (!rootEl) return
    rootEl.setAttribute('data-theme', resolvedTheme)
    if (getPreviewRounded()) rootEl.setAttribute('data-preview-rounded', 'true')
    if (primaryColor) rootEl.style.setProperty('--auxx-chat-primary', primaryColor)
    if (tintHue !== null) rootEl.style.setProperty('--auxx-chat-tint-h', String(tintHue))
    if (primaryColorDark) rootEl.style.setProperty('--auxx-chat-primary-dark', primaryColorDark)
    else rootEl.style.removeProperty('--auxx-chat-primary-dark')
    if (headerColor) rootEl.style.setProperty('--auxx-chat-header', headerColor)
    else rootEl.style.removeProperty('--auxx-chat-header')
    if (headerColorDark) rootEl.style.setProperty('--auxx-chat-header-dark', headerColorDark)
    else rootEl.style.removeProperty('--auxx-chat-header-dark')
  }, [
    shadowRoot,
    resolvedTheme,
    primaryColor,
    tintHue,
    primaryColorDark,
    headerColor,
    headerColorDark,
  ])

  const router = useTabRouter(channelId)
  const subscribeRef = useRef<{
    onThreadUpdated: (cb: (e: ThreadUpdatedEvent) => void) => () => void
    onThreadCreated: (cb: (e: ThreadCreatedEvent) => void) => () => void
  } | null>(null)

  useEffect(() => {
    fetchChatConfig(channelId, cacheBust)
      .then((c) => {
        setConfig(c)
        if (c.appearance.autoOpen || getStartOpen()) setOpen(true)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load chat'))
  }, [channelId, cacheBust])

  useEffect(() => {
    if (config && config.home.knowledgeBase === null && router.activeTab === 'help') {
      router.setActiveTab('home')
    }
  }, [config, router.activeTab, router.setActiveTab])

  // Per-visitor channel: mint the passport eagerly so the visitor channel can
  // connect even when the widget hasn't been opened yet. The badge fires off
  // realtime events without requiring an open-state subscription.
  useEffect(() => {
    if (!config) return
    let cancelled = false
    let handle: Awaited<ReturnType<typeof connectVisitorChannel>> | null = null
    let lastSnapshot: Awaited<ReturnType<ReturnType<typeof chatApi>['listThreads']>> | null = null

    const refreshUnread = async () => {
      try {
        const data = await chatApi(channelId).listThreads(null)
        if (cancelled) return
        lastSnapshot = data
        setUnreadCount(countUnread(channelId, data.items))
      } catch {
        /* keep current count */
      }
    }

    ;(async () => {
      try {
        handle = await connectVisitorChannel(channelId, config)
        if (cancelled) {
          handle?.disconnect()
          return
        }
        subscribeRef.current = {
          onThreadUpdated: handle.onThreadUpdated,
          onThreadCreated: handle.onThreadCreated,
        }
        handle.onThreadUpdated(() => refreshUnread())
        handle.onThreadCreated(() => refreshUnread())
        refreshUnread()
      } catch (e) {
        if (!cancelled) console.warn('[auxx-chat-widget] visitor channel failed', e)
      }
    })()

    return () => {
      cancelled = true
      handle?.disconnect()
      subscribeRef.current = null
    }
  }, [channelId, config])

  // When the widget opens or the active tab changes to Messages, refresh
  // unread off local storage (covers the case where the user reads a thread
  // while still connected).
  useEffect(() => {
    if (!open) return
    const items = chatApi(channelId)
    items
      .listThreads(null)
      .then((data) => setUnreadCount(countUnread(channelId, data.items)))
      .catch(() => {})
  }, [channelId, open, router.activeTab, router.currentStack.current?.id])

  // Only an explicit user toggle (the menu button in a thread) writes to LS —
  // entering/leaving thread views never mutates the preference. That way once
  // a visitor expands, every subsequent thread they open auto-expands until
  // they shrink it themselves.
  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev
      writeExpanded(channelId, next)
      return next
    })
  }, [channelId])

  // Expand mode is thread-only. On entering a thread, restore the visitor's
  // sticky preference. On leaving, collapse visually but leave the preference
  // untouched. Floating mode supersedes expanded — skip restoration while
  // detached.
  const currentView = router.currentStack.current?.view ?? router.activeTab
  useEffect(() => {
    if (floatPosition) return
    if (currentView === 'thread') {
      setExpanded(readExpanded(channelId))
    } else {
      setExpanded(false)
    }
  }, [currentView, channelId, floatPosition])

  // Visual flags for the float entry/exit animations:
  //   `bobbing`   — 4-cycle up/down translate keyframe applied right after
  //                 the panel detaches.
  //   `docking`   — left/top transition re-enabled while we tween the panel
  //                 back to its corner before clearing floatPosition.
  const [bobbing, setBobbing] = useState(false)
  const [docking, setDocking] = useState(false)
  const dockTimerRef = useRef<number | null>(null)
  const bobTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (dockTimerRef.current !== null) window.clearTimeout(dockTimerRef.current)
      if (bobTimerRef.current !== null) window.clearTimeout(bobTimerRef.current)
    },
    []
  )

  const toggleFloating = useCallback(() => {
    if (docking) return
    if (floatPosition) {
      // Re-dock: tween left/top back to the corner, then drop floatPosition
      // so the corner-anchored CSS takes over.
      if (!shellEl) {
        setFloatPosition(null)
        return
      }
      const rect = shellEl.getBoundingClientRect()
      const isLeft = config?.appearance.position.toLowerCase().includes('left') ?? false
      const edgeGap = 20
      const target = {
        x: isLeft ? edgeGap : Math.max(edgeGap, window.innerWidth - rect.width - edgeGap),
        y: Math.max(edgeGap, window.innerHeight - rect.height - edgeGap),
      }
      setDocking(true)
      setFloatPosition(target)
      if (dockTimerRef.current !== null) window.clearTimeout(dockTimerRef.current)
      dockTimerRef.current = window.setTimeout(() => {
        setFloatPosition(null)
        setDocking(false)
        dockTimerRef.current = null
      }, 340)
      return
    }
    // Detach: place the panel at its current location and bob for ~4 cycles.
    const rect = shellEl?.getBoundingClientRect()
    const next = rect
      ? clampToViewport({ x: rect.left, y: rect.top }, rect.width, rect.height)
      : { x: 20, y: 20 }
    setExpanded(false)
    setFloatPosition(next)
    setBobbing(true)
    if (bobTimerRef.current !== null) window.clearTimeout(bobTimerRef.current)
    bobTimerRef.current = window.setTimeout(() => {
      setBobbing(false)
      bobTimerRef.current = null
    }, 1600 * 2)
  }, [docking, floatPosition, shellEl, config?.appearance.position])

  const handleClose = useCallback(() => {
    setOpen(false)
    setFloatPosition(null)
    setBobbing(false)
    setDocking(false)
    if (dockTimerRef.current !== null) {
      window.clearTimeout(dockTimerRef.current)
      dockTimerRef.current = null
    }
    if (bobTimerRef.current !== null) {
      window.clearTimeout(bobTimerRef.current)
      bobTimerRef.current = null
    }
  }, [])

  const isFloating = open && floatPosition !== null

  useDragShell({
    enabled: isFloating && !docking,
    shellEl,
    headerEl,
    position: floatPosition,
    onPositionChange: setFloatPosition,
  })

  const direction = useTransitionDirection({
    activeTab: router.activeTab,
    stackLength: router.currentStack.stack.length,
    currentId: router.currentStack.current?.id ?? null,
  })

  if (!config) return null

  // Phase 10 — `users`-audience channels stay hidden for anonymous visitors.
  // The server-side gate (passport mint) is the source of truth; this just
  // prevents painting a launcher that would 401 on click. The admin preview
  // iframe sets `previewBypassAudience` so it keeps rendering for testers.
  if (config.chatAudience === 'users' && !getUserJwt() && !getPreviewBypassAudience()) {
    return null
  }

  const positionClass = isFloating
    ? 'auxx-chat-shell--floating'
    : config.appearance.position.toLowerCase().includes('left')
      ? 'auxx-chat-shell--bottom-left'
      : 'auxx-chat-shell--bottom-right'
  const stateClass = open ? 'auxx-chat-shell--open' : 'auxx-chat-shell--closed'
  const expandedClass = open && expanded && !isFloating ? 'auxx-chat-shell--expanded' : ''
  const bobbingClass = bobbing && isFloating ? 'auxx-chat-shell--bobbing' : ''
  const dockingClass = docking ? 'auxx-chat-shell--docking' : ''
  const shellStyle: Record<string, string> = {}
  if (isFloating && floatPosition) {
    shellStyle.left = `${floatPosition.x}px`
    shellStyle.top = `${floatPosition.y}px`
    shellStyle.right = 'auto'
    shellStyle.bottom = 'auto'
  }

  return (
    <div className='auxx-chat-root' data-theme={resolvedTheme}>
      <div
        ref={shellRefCallback}
        className={`auxx-chat-shell ${stateClass} ${positionClass} ${expandedClass} ${bobbingClass} ${dockingClass}`}
        style={shellStyle}>
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
        {!open && unreadCount > 0 ? (
          <span className='auxx-chat-shell__badge' aria-label={`${unreadCount} unread`}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
        <div
          className='auxx-chat-shell__panel'
          role='dialog'
          aria-modal='false'
          aria-label={config.appearance.title}
          aria-hidden={!open}>
          <NavStackProvider value={router.currentStack}>
            <FrameTransition
              viewKey={`${router.activeTab}|${router.currentStack.current?.id ?? 'root'}`}
              direction={direction}>
              <PanelShell
                channelId={channelId}
                config={config}
                resolvedTheme={resolvedTheme}
                activeTab={router.activeTab}
                currentFrame={router.currentStack.current}
                isAtRoot={router.currentStack.isAtRoot}
                onBack={router.currentStack.pop}
                onClose={handleClose}
                error={error}
                subscribe={subscribeRef.current ?? undefined}
                expanded={expanded}
                onToggleExpanded={toggleExpanded}
                floating={isFloating}
                onToggleFloating={toggleFloating}
                headerRef={headerRefCallback}
              />
            </FrameTransition>
            {router.currentStack.isAtRoot ? (
              <TabBar
                activeTab={router.activeTab}
                onChange={router.setActiveTab}
                showHelp={config.home.knowledgeBase !== null}
              />
            ) : null}
          </NavStackProvider>
        </div>
      </div>
    </div>
  )
}

interface PanelShellProps {
  channelId: string
  config: ChatConfig
  resolvedTheme: 'light' | 'dark'
  activeTab: TabId
  currentFrame: NavFrame | null
  isAtRoot: boolean
  onBack: () => void
  onClose: () => void
  error: string | null
  subscribe?: {
    onThreadUpdated: (cb: (e: ThreadUpdatedEvent) => void) => () => void
    onThreadCreated: (cb: (e: ThreadCreatedEvent) => void) => () => void
  }
  expanded: boolean
  onToggleExpanded: () => void
  floating: boolean
  onToggleFloating: () => void
  headerRef: Ref<HTMLElement>
}

function PanelShell({
  channelId,
  config,
  resolvedTheme,
  activeTab,
  currentFrame,
  isAtRoot,
  onBack,
  onClose,
  error,
  subscribe,
  expanded,
  onToggleExpanded,
  floating,
  onToggleFloating,
  headerRef,
}: PanelShellProps) {
  const view: NavView = currentFrame?.view ?? activeTab
  const headerVariant = pickHeaderVariant(view, isAtRoot)
  const threadId =
    view === 'thread' && typeof currentFrame?.params?.threadId === 'string'
      ? (currentFrame.params.threadId as string)
      : null

  const hideHeader = view === 'home' && isAtRoot

  return (
    <div className='auxx-chat-frame flex h-full flex-col'>
      {hideHeader ? null : (
        <FrameHeader
          variant={headerVariant}
          title={headerTitle(view, currentFrame, config)}
          subtitle={view === 'thread' ? (config.appearance.subtitle ?? undefined) : undefined}
          logoLight={config.appearance.logoLight}
          logoDark={config.appearance.logoDark}
          resolvedTheme={resolvedTheme}
          onBack={isAtRoot ? undefined : onBack}
          onClose={onClose}
          floating={floating}
          onToggleFloating={onToggleFloating}
          headerRef={headerRef}
          actions={
            threadId ? (
              <ConversationMenu
                channelId={channelId}
                threadId={threadId}
                expanded={expanded}
                onToggleExpanded={onToggleExpanded}
                allowDownloadTranscript={config.allowDownloadTranscript}
                floating={floating}
              />
            ) : undefined
          }
        />
      )}
      {error ? (
        <div className='px-2.5 py-1.5 text-center text-xs text-destructive' role='alert'>
          {error}
        </div>
      ) : null}
      <div className='auxx-chat-frame flex min-h-0 flex-1 flex-col'>
        {renderFrame(
          view,
          currentFrame,
          channelId,
          config,
          resolvedTheme,
          subscribe,
          onClose,
          floating,
          onToggleFloating,
          headerRef
        )}
      </div>
    </div>
  )
}

function pickHeaderVariant(view: NavView, isAtRoot: boolean): FrameHeaderVariant {
  if (!isAtRoot) return 'contextual'
  if (view === 'home') return 'dark-hero'
  return 'plain'
}

function headerTitle(view: NavView, frame: NavFrame | null, config: ChatConfig): string {
  // The conversation header answers "who am I talking to?" — always the agent
  // name, regardless of how the thread was opened (Home passed the thread
  // subject like "Chat #2892", Messages passed the agent name). KB frames keep
  // their own pushed label (article/section title).
  if (frame?.view === 'thread') return config.agent?.name ?? 'Support'
  if (frame) return frame.label
  if (view === 'home') return config.appearance.title
  if (view === 'messages') return 'Messages'
  if (view === 'help') return config.home.knowledgeBase?.siteName ?? 'Help'
  return ''
}

function renderFrame(
  view: NavView,
  frame: NavFrame | null,
  channelId: string,
  config: ChatConfig,
  resolvedTheme: 'light' | 'dark',
  subscribe?: PanelShellProps['subscribe'],
  onClose?: () => void,
  floating?: boolean,
  onToggleFloating?: () => void,
  headerRef?: Ref<HTMLElement>
) {
  switch (view) {
    case 'home':
      return (
        <HomeView
          channelId={channelId}
          config={config}
          resolvedTheme={resolvedTheme}
          onClose={onClose}
          floating={floating}
          onToggleFloating={onToggleFloating}
          headerRef={headerRef}
        />
      )
    case 'messages':
      return <MessagesView channelId={channelId} subscribe={subscribe} config={config} />
    case 'help':
      return <KbSectionView channelId={channelId} sectionId={null} />
    case 'thread': {
      const raw = frame?.params?.threadId
      if (typeof raw !== 'string') return null
      return <ConversationView channelId={channelId} threadId={raw} config={config} />
    }
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

function countUnread(
  channelId: string,
  items: { id: string; lastMessage: { isInbound: boolean; sentAt: string } }[]
): number {
  let count = 0
  for (const t of items) {
    if (t.lastMessage.isInbound) continue
    const lastRead = getLastReadAt(channelId, t.id)
    if (!lastRead || new Date(t.lastMessage.sentAt) > new Date(lastRead)) {
      count += 1
    }
  }
  return count
}
