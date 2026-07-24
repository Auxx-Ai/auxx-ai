// apps/web/src/components/mail/read-only-thread-provider.tsx
'use client'

import type React from 'react'
import { useMemo } from 'react'
import type { EmailActions } from './email-actions'
import { ThreadContext } from './thread-provider'

/**
 * Empty actions object. `ThreadMessages` and its display children read only
 * `emailActions` (passed down as `messageActions`) — when it's empty they hide
 * every action affordance (dropdown + inline reply/forward), giving a read-only
 * render for free. The full `ThreadProvider` already returns `{}` for
 * `emailActions` when there's no thread, so an empty actions object is precedented.
 */
const NOOP_ACTIONS = {} as EmailActions

/**
 * Lightweight, read-only alternative to {@link ThreadProvider} for previewing a
 * thread's messages (e.g. inside the command palette's thread reader).
 *
 * It supplies {@link ThreadContext} with just `threadId` + a no-op
 * `emailActions`, skipping the full provider's per-mount weight: `useReplyBox`,
 * `api.record.create`, `api.participant.ensureContact`, and the entire
 * mutations/handlers graph. That machinery is never used in a passive preview,
 * and the right pane remounts on every row swap — so this avoids real per-click
 * cost. `ThreadMessages`'s display children consume only `threadId` +
 * `emailActions` from the context; everything else they need comes from store
 * hooks, independent of the provider.
 */
export function ReadOnlyThreadProvider({
  threadId,
  children,
}: {
  threadId: string
  children: React.ReactNode
}) {
  const value = useMemo(
    () =>
      ({
        threadId,
        emailActions: NOOP_ACTIONS,
        replyBox: {},
        mutations: {},
        handlers: {},
        contactId: null,
      }) as unknown as React.ContextType<typeof ThreadContext>,
    [threadId]
  )

  return <ThreadContext.Provider value={value}>{children}</ThreadContext.Provider>
}
