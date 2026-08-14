// apps/web/src/components/kopilot/hooks/use-embedded-kopilot-surface.ts

'use client'

import { useEffect } from 'react'
import { useKopilotStore } from '../stores/kopilot-store'

/**
 * Declare this component an embedded Kopilot chat surface for as long as it is
 * mounted, which hides the global dock (`kopilot-dock.tsx`).
 *
 * The kopilot store is a singleton — one `activeSessionId`, one message list,
 * one SSE runner — so a page that hosts its own chat must not also offer the
 * dock: both would render the same conversation, and the dock's session picker
 * could swap the embedded surface's thread out from under it.
 *
 * Actions are read from `getState()` rather than subscribed: they are stable,
 * and subscribing would re-run the effect on every store write.
 */
export function useEmbeddedKopilotSurface(): void {
  useEffect(() => {
    const { registerEmbeddedSurface, unregisterEmbeddedSurface } = useKopilotStore.getState()
    registerEmbeddedSurface()
    return unregisterEmbeddedSurface
  }, [])
}
