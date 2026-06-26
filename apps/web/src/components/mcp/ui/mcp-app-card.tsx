// apps/web/src/components/mcp/ui/mcp-app-card.tsx
'use client'

import { ListCard, renderBadgeChips } from '@auxx/ui/components/list-card'
import { toastError } from '@auxx/ui/components/toast'
import { Plug, Trash } from 'lucide-react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { McpServerListEntry } from '../hooks/use-mcp-servers'
import { mcpStatus } from './mcp-status-pill'

const STATUS_LABEL: Record<ReturnType<typeof mcpStatus>, string> = {
  connected: 'Connected',
  needs_reconnect: 'Reconnect',
  sync_error: 'Sync error',
  not_connected: '',
}

interface McpAppCardProps {
  server: McpServerListEntry
  /** Show an uninstall action in the card dropdown (admin-only mutation). */
  canUninstall?: boolean
  /** Called after the server was removed, to refresh the list. */
  onRemoved?: () => void
}

/**
 * `ListCard`-shaped card for an MCP server, used in both the browse (curated) and installed
 * sections of Settings → Apps. Carries an "MCP" badge; connected servers also show a status badge.
 * Links to the server's detail page.
 */
export function McpAppCard({ server, canUninstall, onRemoved }: McpAppCardProps) {
  const statusLabel = STATUS_LABEL[mcpStatus(server)]
  const [confirm, ConfirmDialog] = useConfirm()
  const remove = api.mcp.delete.useMutation()

  const showUninstall = canUninstall && (server.connectionPresent || server.isCustom)

  async function handleUninstall() {
    const ok = await confirm({
      title: 'Uninstall MCP server?',
      description: 'Agents using its tools will lose them.',
      confirmText: 'Uninstall',
      destructive: true,
    })
    if (!ok) return
    try {
      await remove.mutateAsync({ serverId: server.serverId })
      onRemoved?.()
    } catch (err) {
      toastError({
        title: 'Failed to uninstall MCP server',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return (
    <>
      <ConfirmDialog />
      <ListCard
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
        headerEnd={renderBadgeChips([
          { label: 'MCP' },
          ...(statusLabel ? [{ label: statusLabel }] : []),
        ])}
        menuItems={
          showUninstall
            ? [
                {
                  label: 'Uninstall',
                  icon: <Trash />,
                  destructive: true,
                  disabled: remove.isPending,
                  onClick: () => void handleUninstall(),
                },
              ]
            : undefined
        }
      />
    </>
  )
}
