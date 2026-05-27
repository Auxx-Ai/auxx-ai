// packages/chat/src/navigation/use-tab-router.ts
//
// Per-tab router: each tab owns its own navigation stack and switching tabs
// preserves position in the other tab's stack. A debounced snapshot lands in
// localStorage so reopening the widget on a later page load returns to the
// same active tab.
//
// Deeper-frame restoration is intentionally minimal in Phase 3: the snapshot
// remembers the active tab only, dropping deeper frames on cross-page reload.
// Phases 4–6 can opt in to validating + restoring deeper frames once their
// entities (article id, thread id, section id) have resolvers wired up.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { type NavStack, useNavigationStack } from './use-navigation-stack'

export type TabId = 'home' | 'messages' | 'help'

interface PersistedSnapshot {
  activeTab: TabId
}

interface TabRouter {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
  homeStack: NavStack
  messagesStack: NavStack
  helpStack: NavStack
  currentStack: NavStack
}

const STORAGE_PREFIX = 'auxx-chat-route:'
const PERSIST_DEBOUNCE_MS = 200

function storageKey(channelId: string): string {
  return `${STORAGE_PREFIX}${channelId}`
}

function readSnapshot(channelId: string): PersistedSnapshot | null {
  try {
    const raw = window.localStorage.getItem(storageKey(channelId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { activeTab?: unknown }
    if (
      parsed.activeTab === 'home' ||
      parsed.activeTab === 'messages' ||
      parsed.activeTab === 'help'
    ) {
      return { activeTab: parsed.activeTab }
    }
  } catch {
    // ignore — fall back to defaults
  }
  return null
}

function writeSnapshot(channelId: string, snapshot: PersistedSnapshot): void {
  try {
    window.localStorage.setItem(storageKey(channelId), JSON.stringify(snapshot))
  } catch {
    // ignore — storage may be full or disabled
  }
}

export function useTabRouter(channelId: string, initialTab: TabId = 'home'): TabRouter {
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (typeof window === 'undefined') return initialTab
    return readSnapshot(channelId)?.activeTab ?? initialTab
  })

  const homeStack = useNavigationStack()
  const messagesStack = useNavigationStack()
  const helpStack = useNavigationStack()
  const currentStack =
    activeTab === 'home' ? homeStack : activeTab === 'messages' ? messagesStack : helpStack

  const timerRef = useRef<number | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      writeSnapshot(channelId, { activeTab })
    }, PERSIST_DEBOUNCE_MS)
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [channelId, activeTab])

  return useMemo(
    () => ({ activeTab, setActiveTab, homeStack, messagesStack, helpStack, currentStack }),
    [activeTab, homeStack, messagesStack, helpStack, currentStack]
  )
}
