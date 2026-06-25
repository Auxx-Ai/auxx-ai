// apps/web/src/components/mcp/hooks/use-mcp-connect.tsx
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { type ReactNode, useState } from 'react'
import { api } from '~/trpc/react'
import { ConnectCuratedDialog } from '../ui/connect-curated-dialog'
import type { McpDetailServer } from '../ui/mcp-server-detail'
import { useMcpOAuthPopup } from './use-mcp-oauth-popup'

export interface UseMcpConnect {
  /** Begin a connect/reconnect for the server: OAuth popup, direct connect, or the field dialog. */
  start: () => void
  /** The curated connect dialog (variables/secret) — mount once per caller. */
  Dialogs: ReactNode
  /** An in-flight connect mutation or OAuth popup. */
  pending: boolean
  /**
   * True for a custom OAuth server with no stored client creds: the authorize popup can only
   * fail, so the caller must route the user through a manual OAuth-app setup instead of `start`.
   */
  needsManualSetup: boolean
}

/**
 * The shared connect/reconnect decision for an MCP server, lifted out of the server detail page so
 * other surfaces (e.g. the unified connections grid) drive the exact same flow. Curated OAuth with
 * no variables — and any reconnect of a curated non-secret server — connects through `mcp.connect`
 * and opens the OAuth popup directly; custom OAuth servers reconnect via the authorize popup;
 * everything else (curated with variables / secret) opens {@link ConnectCuratedDialog}.
 */
export function useMcpConnect(
  server: McpDetailServer | null,
  onChanged: () => void,
  /** Fired when the curated dialog closes (cancel or after connect) — lets a host clear its state. */
  onDialogClose?: () => void
): UseMcpConnect {
  const [dialogOpen, setDialogOpen] = useState(false)
  const oauth = useMcpOAuthPopup()
  const connect = api.mcp.connect.useMutation()

  const isOAuth = server?.connectionType === 'oauth2-code'
  const isSecret = server?.connectionType === 'secret'
  const hasVariables = (server?.connectionVariables.length ?? 0) > 0

  // Custom OAuth server with no client creds (the provider has no DCR, e.g. GitHub) — the
  // authorize popup can only fail, so the caller must offer a setup walkthrough instead.
  const needsManualSetup =
    !!server && server.isCustom && isOAuth && !server.oauth?.clientId && !server.connectionPresent

  async function start() {
    if (!server) return
    // Curated OAuth with no variables, or any reconnect of an OAuth server → straight to the popup.
    const zeroVarOAuth = isOAuth && !hasVariables
    if (!server.isCustom && (zeroVarOAuth || (!isSecret && !hasVariables))) {
      try {
        const result = await connect.mutateAsync({ serverId: server.serverId })
        if ('connected' in result && result.connected) {
          onChanged()
          return
        }
        if ('needsOAuth' in result && result.needsOAuth) {
          oauth.open({
            authorizeUrl: result.authorizeUrl,
            verifyServer: { serverId: server.serverId },
            onDone: (ok) => ok && onChanged(),
          })
          return
        }
        toastError({
          title: 'Connection not available',
          description: 'This server could not be connected automatically.',
        })
      } catch (err) {
        toastError({
          title: 'Failed to connect',
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      }
      return
    }
    // Custom OAuth reconnect → authorize popup directly (no curated connect endpoint for custom).
    if (server.isCustom && isOAuth) {
      if (needsManualSetup) return
      oauth.open({
        authorizeUrl: `/api/mcp/${server.serverId}/oauth2/authorize?returnTo=${encodeURIComponent(
          `/app/settings/apps/mcp/${server.slug}`
        )}`,
        verifyServer: { serverId: server.serverId },
        onDone: (ok) => ok && onChanged(),
      })
      return
    }
    // Everything else (curated with variables / secret) → the dialog.
    setDialogOpen(true)
  }

  const Dialogs = server ? (
    <ConnectCuratedDialog
      open={dialogOpen}
      onOpenChange={(next) => {
        setDialogOpen(next)
        if (!next) onDialogClose?.()
      }}
      serverId={server.serverId}
      serverName={server.name}
      serverSlug={server.slug}
      connectionType={server.connectionType}
      connectionVariables={server.connectionVariables}
      onConnected={onChanged}
    />
  ) : null

  return { start, Dialogs, pending: connect.isPending || oauth.pending, needsManualSetup }
}
