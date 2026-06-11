// apps/web/src/components/mcp/hooks/use-mcp-oauth-popup.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef, useState } from 'react'

interface OAuthDonePayload {
  type: 'oauth_done'
  ok: boolean
  credId?: string | null
  error?: string | null
}

export interface OpenMcpOAuthOptions {
  /** Server-built authorize URL (`/api/mcp/<serverId>/oauth2/authorize?...`). */
  authorizeUrl: string
  /** Fired once the popup reports completion (success or failure). */
  onDone: (ok: boolean) => void
}

/**
 * Opens the MCP OAuth popup and resolves when the server-rendered callback page posts
 * `{ type: 'oauth_done' }` (via `postMessage` and the `oauth-mcp-connect` BroadcastChannel).
 * Falls back to a full-page redirect if the popup is blocked. Mirrors `useConnectFlow`'s popup
 * machinery, scoped to MCP.
 */
export function useMcpOAuthPopup() {
  const [pending, setPending] = useState(false)

  const teardownRef = useRef<(() => void) | null>(null)
  const teardown = useCallback(() => {
    teardownRef.current?.()
    teardownRef.current = null
  }, [])
  useEffect(() => () => teardown(), [teardown])

  const open = useCallback(
    ({ authorizeUrl, onDone }: OpenMcpOAuthOptions) => {
      const popupUrl = authorizeUrl.includes('?')
        ? `${authorizeUrl}&mode=popup`
        : `${authorizeUrl}?mode=popup`
      const popup = window.open(popupUrl, 'auxx-mcp-oauth', 'popup=yes,width=600,height=720')
      if (!popup) {
        // Popup blocked — fall back to a full-page redirect.
        window.location.href = authorizeUrl
        return
      }

      teardown()
      setPending(true)

      const handleDone = (payload: OAuthDonePayload) => {
        teardown()
        if (!payload.ok) {
          toastError({
            title: 'Failed to connect',
            description: payload.error || 'Connection failed',
          })
        }
        onDone(payload.ok)
      }

      const onMessage = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return
        if (!e.data || e.data.type !== 'oauth_done') return
        handleDone(e.data as OAuthDonePayload)
      }
      window.addEventListener('message', onMessage)

      let bc: BroadcastChannel | null = null
      try {
        bc = new BroadcastChannel('oauth-mcp-connect')
        bc.onmessage = (e) => {
          if (!e.data || e.data.type !== 'oauth_done') return
          handleDone(e.data as OAuthDonePayload)
        }
      } catch {
        // BroadcastChannel unavailable — postMessage path still works.
      }

      const closedInterval = setInterval(() => {
        if (popup.closed) teardown()
      }, 500)

      teardownRef.current = () => {
        window.removeEventListener('message', onMessage)
        bc?.close()
        clearInterval(closedInterval)
        try {
          if (!popup.closed) popup.close()
        } catch {
          // ignore
        }
        setPending(false)
      }
    },
    [teardown]
  )

  return { open, pending }
}
