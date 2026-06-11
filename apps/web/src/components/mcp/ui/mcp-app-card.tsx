// apps/web/src/components/mcp/ui/mcp-app-card.tsx
'use client'

import { Plug } from 'lucide-react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { AppListCard } from '~/components/apps/ui/app-list-card'
import type { McpServerListEntry } from '../hooks/use-mcp-servers'
import { mcpStatus } from './mcp-status-pill'

const STATUS_LABEL: Record<ReturnType<typeof mcpStatus>, string> = {
  connected: 'Connected',
  needs_reconnect: 'Reconnect',
  sync_error: 'Sync error',
  not_connected: '',
}

/**
 * `AppListCard`-shaped card for an MCP server, used in both the browse (curated) and installed
 * sections of Settings → Apps. Carries an "MCP" badge; connected servers also show a status badge.
 * Links to the server's detail page.
 */
export function McpAppCard({ server }: { server: McpServerListEntry }) {
  const statusLabel = STATUS_LABEL[mcpStatus(server)]
  return (
    <AppListCard
      title={server.name}
      description={server.description}
      href={`/app/settings/apps/mcp/${server.slug}`}
      icon={
        server.icon?.iconId ? (
          <AppIcon iconId={server.icon.iconId} color={server.icon.color} size='sm' />
        ) : (
          <Plug className='size-4 text-muted-foreground' />
        )
      }
      subtitle={server.isCustom ? 'Custom server' : 'Curated'}
      badges={[{ label: 'MCP' }, ...(statusLabel ? [{ label: statusLabel }] : [])]}
    />
  )
}
