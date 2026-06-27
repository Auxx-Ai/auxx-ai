// apps/web/src/components/threads/providers/thread-actions-provider.tsx
'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { useThreadMutation } from '../hooks'

/**
 * Stable thread-action callbacks shared by every thread list row.
 *
 * Without this, each `MailThreadItem` / `CompactThreadItem` (and each nested
 * `ProcessingMenu`) called `useThreadMutation()` itself — 4 `useMutation()` +
 * count-store subscriptions per row, multiplied across hundreds of rows. The
 * toolkit is identical for every row (its `update(threadId, …)` is already
 * id-parameterized), so we create it once here and share it.
 *
 * Deliberately exposes only the action callbacks, not the `isPending` flags:
 * those are volatile (flip on every in-flight mutation) and would re-render
 * every consumer. Rows already reflect changes via the optimistic thread-store
 * update. The callbacks are referentially stable (see the `.mutate` deps in
 * `useThreadMutation` + the stable default in `useCountUpdates`), so this
 * context value never churns.
 */
type ThreadActions = Pick<
  ReturnType<typeof useThreadMutation>,
  'update' | 'updateBulk' | 'remove' | 'removeBulk' | 'merge' | 'unmerge'
>

const ThreadActionsContext = createContext<ThreadActions | null>(null)

export function ThreadActionsProvider({ children }: { children: ReactNode }) {
  const { update, updateBulk, remove, removeBulk, merge, unmerge } = useThreadMutation()
  const value = useMemo<ThreadActions>(
    () => ({ update, updateBulk, remove, removeBulk, merge, unmerge }),
    [update, updateBulk, remove, removeBulk, merge, unmerge]
  )
  return <ThreadActionsContext.Provider value={value}>{children}</ThreadActionsContext.Provider>
}

/**
 * Read the shared thread-action callbacks. Throws if no ThreadActionsProvider
 * is mounted above — every thread-item render site lives under the app layout's
 * provider, so a missing provider is a wiring bug, not a runtime branch.
 */
export function useThreadActions(): ThreadActions {
  const ctx = useContext(ThreadActionsContext)
  if (!ctx) {
    throw new Error('useThreadActions must be used within a ThreadActionsProvider')
  }
  return ctx
}
