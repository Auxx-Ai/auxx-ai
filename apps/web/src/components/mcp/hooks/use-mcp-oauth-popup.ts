// apps/web/src/components/mcp/hooks/use-mcp-oauth-popup.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'

type McpListEntry = RouterOutputs['mcp']['list'][number]

interface OAuthDonePayload {
  type: 'oauth_done'
  ok: boolean
  credId?: string | null
  error?: string | null
}

/** Identifies the server whose connection the hook polls for while the popup is open. */
export interface VerifyServerMatch {
  serverId?: string
  slug?: string
  endpoint?: string
}

export interface OpenMcpOAuthOptions {
  /** Server-built authorize URL (`/api/mcp/<serverId>/oauth2/authorize?...`). */
  authorizeUrl: string
  /** Fired once the connect is confirmed, failed, or timed out. */
  onDone: (ok: boolean) => void
  /**
   * The server being connected — drives the authoritative success signal: poll `mcp.list` until
   * the server's credential snapshot changes (connect: `connectionPresent` flips on; reconnect:
   * the expiry/sync stamps move). Always pass this for OAuth connects.
   */
  verifyServer?: VerifyServerMatch
  /** Custom poll override; wins over `verifyServer`. Returns true once the connect landed. */
  verify?: () => Promise<boolean>
}

/**
 * Opens the MCP OAuth popup and resolves when the connect is confirmed — instantly via the
 * termination page's `postMessage`/`oauth-mcp-connect` BroadcastChannel (`/api/mcp/oauth-complete`
 * runs on this window's origin, so both channels reach it), with server-side polling as the
 * authoritative backstop. The popup lifecycle never settles the flow: providers that send
 * `Cross-Origin-Opener-Policy: same-origin` (e.g. Stripe) sever the browsing-context group,
 * after which `popup.closed` is wrong in both directions (reads `true` while the popup is still
 * on the consent screen, and can stay `false` after a real close). A genuine user-cancel
 * therefore spins until the hard timeout. Falls back to a full-page redirect if the popup is
 * blocked.
 */
export function useMcpOAuthPopup() {
  const [pending, setPending] = useState(false)
  const utils = api.useUtils()

  const teardownRef = useRef<(() => void) | null>(null)
  const teardown = useCallback(() => {
    teardownRef.current?.()
    teardownRef.current = null
  }, [])
  useEffect(() => () => teardown(), [teardown])

  const open = useCallback(
    ({ authorizeUrl, onDone, verifyServer, verify }: OpenMcpOAuthOptions) => {
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

      let settled = false

      /** Settle exactly once: a toast only on explicit failure (not on cancel/timeout). */
      const finish = (ok: boolean, error?: string | null) => {
        if (settled) return
        settled = true
        teardown()
        if (!ok && error) {
          toastError({ title: 'Failed to connect', description: error })
        }
        onDone(ok)
      }

      const handleDone = (payload: OAuthDonePayload) => {
        finish(payload.ok, payload.ok ? undefined : payload.error || 'Connection failed')
      }

      const onMessage = (e: MessageEvent) => {
        // The callback page may live on a different origin in dev (NGROK_URL tunnel), so also
        // trust messages coming from the popup window we opened ourselves.
        if (e.source !== popup && e.origin !== window.location.origin) return
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

      const verifyFn = verify ?? (verifyServer ? buildSnapshotVerify(utils, verifyServer) : null)
      const verifyInterval = verifyFn
        ? setInterval(() => {
            void (async () => {
              if (settled) return
              try {
                if (await verifyFn()) finish(true)
              } catch {
                // Transient fetch error — the next tick retries.
              }
            })()
          }, 1500)
        : null

      // Hard ceiling so an undetectable user-cancel doesn't spin forever.
      const giveUpTimer = setTimeout(() => finish(false), 180_000)

      teardownRef.current = () => {
        window.removeEventListener('message', onMessage)
        bc?.close()
        if (verifyInterval) clearInterval(verifyInterval)
        clearTimeout(giveUpTimer)
        try {
          if (!popup.closed) popup.close()
        } catch {
          // ignore
        }
        setPending(false)
      }
    },
    [teardown, utils]
  )

  return { open, pending }
}

/**
 * Default verify: re-fetch `mcp.list` each tick and report success once the matched server's
 * credential snapshot differs from its pre-popup baseline. The baseline makes reconnects work —
 * `connectionPresent` is already true before the popup, so success is a *changed* expiry/sync
 * stamp, not presence. (A reconnect against a provider that returns no token expiry AND whose
 * inline tool-sync fails yields no change to observe; the message fast-path still covers it.)
 */
function buildSnapshotVerify(
  utils: ReturnType<typeof api.useUtils>,
  match: VerifyServerMatch
): () => Promise<boolean> {
  const find = (list: McpListEntry[]) =>
    list.find(
      (s) =>
        (!!match.serverId && s.serverId === match.serverId) ||
        (!!match.slug && s.slug === match.slug) ||
        (!!match.endpoint && s.endpoint === match.endpoint)
    )
  const snapshot = (s: McpListEntry) => `${s.connectionExpiresAt ?? ''}|${s.lastSyncedAt ?? ''}`

  // Baseline from the cached list when available; otherwise the first tick records it.
  let baseline: string | null = null
  let baselineKnown = false
  const cached = utils.mcp.list.getData()
  if (cached) {
    const server = find(cached)
    baseline = server?.connectionPresent ? snapshot(server) : null
    baselineKnown = true
  }

  return async () => {
    const list = await utils.mcp.list.fetch(undefined, { staleTime: 0 })
    const server = find(list)
    if (!baselineKnown) {
      baseline = server?.connectionPresent ? snapshot(server) : null
      baselineKnown = true
      return false
    }
    if (!server?.connectionPresent) return false
    return baseline === null || snapshot(server) !== baseline
  }
}
