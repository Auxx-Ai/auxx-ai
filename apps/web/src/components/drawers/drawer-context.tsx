// apps/web/src/components/drawers/drawer-context.tsx
'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { asChatThreadMetadata } from '~/components/mail/chat-thread-metadata'
import { useThread } from '~/components/threads/hooks'

/**
 * Ambient "where was this drawer opened from" context — orthogonal to the
 * entity-type axis (`DRAWER_CONFIG_REGISTRY`). A contact drawer opened while
 * reading a chat thread can use this to surface a "This conversation" card and
 * suppress the now-redundant Conversations tab, without the entity-type config
 * knowing anything about threads.
 *
 * Mirrors `MailFilterProvider` (a thin ambient provider derived from existing
 * state). Default `null` → no behavior change anywhere a provider isn't mounted.
 */
export type DrawerContextValue = {
  kind: 'thread'
  threadId: string
  channel: 'chat' | 'email'
} | null

const DrawerContext = createContext<DrawerContextValue>(null)

/**
 * Provide the active-thread drawer context. `channel` is derived from the
 * thread's metadata so consumers can scope behavior to chat threads.
 */
export function DrawerContextProvider({
  threadId,
  children,
}: {
  threadId: string | null
  children: ReactNode
}) {
  const { thread } = useThread({ threadId: threadId ?? '', enabled: !!threadId })

  const value = useMemo<DrawerContextValue>(() => {
    if (!threadId) return null
    const channel = asChatThreadMetadata(thread?.metadata) ? 'chat' : 'email'
    return { kind: 'thread', threadId, channel }
  }, [threadId, thread?.metadata])

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>
}

/** Read the ambient drawer context. `null` when no provider is mounted. */
export function useDrawerContext(): DrawerContextValue {
  return useContext(DrawerContext)
}
