// apps/web/src/components/mcp/ui/mcp-server-connection-tab.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Plug } from 'lucide-react'
import { useState } from 'react'
import { ConnectionList } from '~/components/apps/ui/connection-list'
import { ConnectionRow, type ConnectionStatus } from '~/components/apps/ui/connection-row'
import { api } from '~/trpc/react'
import { useMcpOAuthPopup } from '../hooks/use-mcp-oauth-popup'
import { ConnectCuratedDialog } from './connect-curated-dialog'
import type { McpDetailServer } from './mcp-server-detail'
import { mcpStatus } from './mcp-status-pill'

const MCP_STATUS_LABEL = {
  connected: 'Connected',
  needs_reconnect: 'Needs reconnect',
  sync_error: 'Sync error',
  not_connected: 'Not connected',
} as const

/** Map the MCP-native status onto the generic `ConnectionRow` icon state. */
const MCP_ROW_STATUS: Record<keyof typeof MCP_STATUS_LABEL, ConnectionStatus> = {
  connected: 'connected',
  needs_reconnect: 'expired',
  sync_error: 'expired',
  not_connected: 'disconnected',
}

interface McpServerConnectionTabProps {
  server: McpDetailServer
  onChanged: () => void
}

/**
 * About + connection sections: server description + endpoint/curated note, then a connection row
 * (status + connect/reconnect). Curated servers route through the `ConnectCuratedDialog`
 * (variables/secret/OAuth); zero-variable OAuth servers connect + open the popup directly. Custom
 * OAuth servers reconnect via the authorize popup. Uninstall lives in the page header.
 */
export function McpServerConnectionTab({ server, onChanged }: McpServerConnectionTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const oauth = useMcpOAuthPopup()

  const connect = api.mcp.connect.useMutation()

  const isOAuth = server.connectionType === 'oauth2-code'
  const hasVariables = server.connectionVariables.length > 0
  const isSecret = server.connectionType === 'secret'

  async function handleConnect() {
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
          oauth.open({ authorizeUrl: result.authorizeUrl, onDone: (ok) => ok && onChanged() })
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
      oauth.open({
        authorizeUrl: `/api/mcp/${server.serverId}/oauth2/authorize?returnTo=${encodeURIComponent(
          `/app/settings/apps/mcp/${server.slug}`
        )}`,
        onDone: (ok) => ok && onChanged(),
      })
      return
    }
    // Everything else (curated with variables / secret) → the dialog.
    setDialogOpen(true)
  }

  const connectLabel = server.connectionPresent ? 'Reconnect' : 'Connect'
  const status = mcpStatus({
    connectionPresent: server.connectionPresent,
    needsReconnect: server.needsReconnect,
    lastSyncError: server.lastSyncError,
  })

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col gap-4'>
        <div>
          <div className='text-xs font-medium text-muted-foreground'>Description</div>
          <div className='text-sm'>{server.description ?? 'No description.'}</div>
        </div>
        {server.isCustom ? (
          <div>
            <div className='text-xs font-medium text-muted-foreground'>Endpoint</div>
            <div className='break-all font-mono text-xs'>{server.endpoint}</div>
          </div>
        ) : (
          <div className='text-sm text-muted-foreground'>
            This is a curated MCP server provided by Auxx. Connect it to give your agents its tools.
          </div>
        )}
      </div>

      <div className='space-y-2'>
        <div className='flex items-center gap-2 tracking-tight font-semibold text-foreground text-base'>
          <Plug className='size-4' />
          Connection
        </div>
        <ConnectionList>
          <ConnectionRow
            status={MCP_ROW_STATUS[status]}
            title={server.name}
            subtitle={
              <>
                {MCP_STATUS_LABEL[status]}
                {server.connectionExpiresAt &&
                  ` · Token expires ${new Date(server.connectionExpiresAt).toLocaleString()}`}
              </>
            }
            actions={() => (
              <Button
                variant='outline'
                size='sm'
                onClick={handleConnect}
                loading={connect.isPending || oauth.pending}
                loadingText='Connecting...'>
                <Plug />
                {connectLabel}
              </Button>
            )}
          />
        </ConnectionList>
      </div>

      <ConnectCuratedDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        serverId={server.serverId}
        serverName={server.name}
        serverSlug={server.slug}
        connectionType={server.connectionType}
        connectionVariables={server.connectionVariables}
        onConnected={onChanged}
      />
    </div>
  )
}
