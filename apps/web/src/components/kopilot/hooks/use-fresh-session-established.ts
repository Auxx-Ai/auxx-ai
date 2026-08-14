// apps/web/src/components/kopilot/hooks/use-fresh-session-established.ts

'use client'

import { useEffect } from 'react'
import { useKopilotStore } from '../stores/kopilot-store'

interface UseFreshSessionEstablishedInput {
  /** True while a "start new chat" is pending its server-created session. */
  fresh: boolean
  /**
   * The newest persisted session for this surface. Used to tell a genuinely
   * new id from the thread the surface was already pointing at.
   */
  latestSessionId: string | null
  /** Called once with the new session id. Must be referentially stable. */
  onEstablished: (sessionId: string) => void
}

/**
 * While a "start new chat" is pending, watch the kopilot store for the
 * server-created session id (set by the `session-created` SSE event) and report
 * it exactly once. Callers use this to stop passing `initialSessionId={null}`,
 * which would otherwise wipe the new thread on the next remount, and to
 * invalidate whatever scoped session lookup they own.
 *
 * The store is read imperatively inside the effect rather than from a
 * subscribed value: at the commit where `fresh` flips on, a subscription still
 * holds whatever session another surface left behind, but `KopilotChat`'s mount
 * effect (a child, so it runs first) has already wiped it by the time this
 * effect executes. Only a genuinely new id — non-null and different from the
 * latest persisted thread — counts as established.
 */
export function useFreshSessionEstablished({
  fresh,
  latestSessionId,
  onEstablished,
}: UseFreshSessionEstablishedInput): void {
  useEffect(() => {
    if (!fresh) return
    let done = false
    const check = (current: string | null) => {
      if (done || !current || current === latestSessionId) return
      done = true
      onEstablished(current)
    }
    check(useKopilotStore.getState().activeSessionId)
    return useKopilotStore.subscribe((state) => check(state.activeSessionId))
  }, [fresh, latestSessionId, onEstablished])
}
