// apps/web/src/components/mcp/ui/mcp-server-connection-tab.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { CopyButton } from '@auxx/ui/components/button-copy'
import { KeyRound, Plug } from 'lucide-react'
import { ConnectionList } from '~/components/apps/ui/connection-list'
import { ConnectionRow, type ConnectionStatus } from '~/components/apps/ui/connection-row'
import { SettingsSection } from '~/components/global/settings-page'
import { useMcpConnect } from '../hooks/use-mcp-connect'
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
  /** Opens the edit dialog hosted by the detail page (the one creds-entry surface). */
  onRequestEdit?: () => void
}

/**
 * About + connection sections: server description + endpoint/curated note, then a connection row
 * (status + connect/reconnect). Curated servers route through the `ConnectCuratedDialog`
 * (variables/secret/OAuth); zero-variable OAuth servers connect + open the popup directly. Custom
 * OAuth servers reconnect via the authorize popup. Uninstall lives in the page header.
 */
export function McpServerConnectionTab({
  server,
  onChanged,
  onRequestEdit,
}: McpServerConnectionTabProps) {
  const mcp = useMcpConnect(server, onChanged)
  const { needsManualSetup } = mcp

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

      <SettingsSection className='space-y-2' icon={Plug} title='Connection'>
        {needsManualSetup ? (
          <div className='flex flex-col gap-3 rounded-lg border p-4 text-sm'>
            <div className='font-medium'>Finish OAuth setup</div>
            {server.templateSetup?.setupHint && (
              <p className='text-muted-foreground'>{server.templateSetup.setupHint}</p>
            )}
            <ol className='list-decimal space-y-1 ps-4 text-muted-foreground'>
              <li>
                {server.templateSetup?.createOAuthAppUrl || server.templateSetup?.docsUrl ? (
                  <a
                    href={
                      server.templateSetup.createOAuthAppUrl ?? server.templateSetup.docsUrl ?? '#'
                    }
                    target='_blank'
                    rel='noreferrer'
                    className='underline underline-offset-2 hover:text-foreground'>
                    Create an OAuth app with the provider
                  </a>
                ) : (
                  'Create an OAuth app with the provider'
                )}
              </li>
              <li>Set its authorization callback URL to the one below</li>
              <li>
                Paste the app's Client ID
                {server.templateSetup?.clientSecretRequired ? ' and Client Secret' : ''} here and
                connect
              </li>
            </ol>
            {server.redirectUri && (
              <div className='flex items-center gap-1'>
                <code className='break-all rounded-md border bg-muted px-2 py-1 font-mono text-xs'>
                  {server.redirectUri}
                </code>
                <CopyButton text={server.redirectUri} />
              </div>
            )}
            <Button variant='outline' size='sm' className='self-start' onClick={onRequestEdit}>
              <KeyRound />
              Add credentials
            </Button>
          </div>
        ) : (
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
                  onClick={mcp.start}
                  loading={mcp.pending}
                  loadingText='Connecting...'>
                  <Plug />
                  {connectLabel}
                </Button>
              )}
            />
          </ConnectionList>
        )}
      </SettingsSection>

      {mcp.Dialogs}
    </div>
  )
}
