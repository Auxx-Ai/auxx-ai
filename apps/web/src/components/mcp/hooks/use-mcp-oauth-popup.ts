// apps/web/src/components/mcp/hooks/use-mcp-oauth-popup.ts
'use client'

import { useCallback } from 'react'
import { useOAuthPopup } from '~/hooks/use-oauth-popup'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'

type McpListEntry = RouterOutputs['mcp']['list'][number]

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
 * MCP OAuth popup — a thin adapter over the shared {@link useOAuthPopup} lifecycle. It supplies
 * the MCP `oauth-mcp-connect` channel and an `mcp.list`-snapshot verify (see
 * {@link buildSnapshotVerify}); the shared core owns the popup, single-settle, message + poll +
 * timeout backstops, and teardown. `/api/mcp/oauth-complete` runs on this window's origin, so the
 * message fast-path reaches it; the poll covers providers (e.g. Stripe) whose
 * `Cross-Origin-Opener-Policy: same-origin` severs the message channel.
 */
export function useMcpOAuthPopup() {
  const utils = api.useUtils()
  const { open: openPopup, pending } = useOAuthPopup()

  const open = useCallback(
    ({ authorizeUrl, onDone, verifyServer, verify }: OpenMcpOAuthOptions) => {
      const verifyFn =
        verify ?? (verifyServer ? buildSnapshotVerify(utils, verifyServer) : undefined)
      openPopup({
        popupUrl: authorizeUrl.includes('?')
          ? `${authorizeUrl}&mode=popup`
          : `${authorizeUrl}?mode=popup`,
        fallbackUrl: authorizeUrl,
        channelName: 'oauth-mcp-connect',
        windowName: 'auxx-mcp-oauth',
        onDone: (ok) => onDone(ok),
        verify: verifyFn,
      })
    },
    [openPopup, utils]
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
