// apps/web/src/components/global/new-message-indicator/use-new-message-indicator.ts
'use client'

import { useEffect } from 'react'
import { useActiveThreadId } from '~/components/threads/store/thread-selection-store'
import { clearUnseenMessages, useNewMessageIndicatorStore } from './store'

/** Title prefix shown while there are unseen messages (binary, no count). */
const TITLE_PREFIX = '• '
/** Id of the client-injected favicon link pointing at the unread variant. */
const FAVICON_LINK_ID = 'auxx-unread-favicon'

/**
 * Out-of-tab new-message indicator controller. Mount once in the authed shell.
 *
 * Reads the shared `hasUnseen` flag (set by the arrival cue on inbound
 * `message:created`) and drives two browser-only surfaces in lockstep:
 *
 * - **Favicon** — appends a `<link rel="icon" href="/unread-icon">` (last icon
 *   link wins) while unseen; removes it on clear, restoring the base `/icon`.
 * - **Tab title** — prefixes `document.title` with `• `. A `MutationObserver` on
 *   `<head>` re-asserts the prefix whenever Next re-applies the route title on
 *   navigation (the `%s | Auxx.ai` template would otherwise strip it).
 *
 * Clears when the user opens any thread (= reading their mail) or refocuses the
 * tab while on a mail route. Tying clear to a read action — not bare focus —
 * matches the persistent-unread UX of Gmail/Slack.
 */
export function useNewMessageIndicator(): void {
  const hasUnseen = useNewMessageIndicatorStore((s) => s.hasUnseen)
  const activeThreadId = useActiveThreadId()

  // Clear on thread open — opening any thread means "I'm reading my mail now".
  useEffect(() => {
    if (activeThreadId) clearUnseenMessages()
  }, [activeThreadId])

  // Clear on tab refocus while on a mail route.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      if (!document.hidden && window.location.pathname.startsWith('/app/mail')) {
        clearUnseenMessages()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Favicon swap.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const existing = document.getElementById(FAVICON_LINK_ID)
    if (hasUnseen) {
      if (!existing) {
        const link = document.createElement('link')
        link.id = FAVICON_LINK_ID
        link.rel = 'icon'
        link.type = 'image/png'
        link.href = '/unread-icon'
        document.head.appendChild(link)
      }
    } else {
      existing?.remove()
    }
  }, [hasUnseen])

  // Tab-title prefix. Re-asserted via a head observer so Next's per-route title
  // writes (the `%s | Auxx.ai` template) can't strip the prefix on navigation.
  useEffect(() => {
    if (typeof document === 'undefined') return

    const apply = () => {
      const stripped = document.title.startsWith(TITLE_PREFIX)
        ? document.title.slice(TITLE_PREFIX.length)
        : document.title
      const next = hasUnseen ? TITLE_PREFIX + stripped : stripped
      // Guard against the observer re-triggering on our own write.
      if (document.title !== next) document.title = next
    }

    apply()
    if (!hasUnseen) return

    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [hasUnseen])
}
