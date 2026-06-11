// apps/web/src/components/mcp/ui/mcp-server-detail.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Plug, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import SettingsPage from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { McpServerConnectionTab } from './mcp-server-connection-tab'
import { McpServerToolsTab } from './mcp-server-tools-tab'
import { McpStatusPill } from './mcp-status-pill'

/** A single server's full detail (snapshot + trust + connection state + variable defs). */
export type McpDetailServer = NonNullable<RouterOutputs['mcp']['getBySlug']>

/**
 * Detail page shell for one MCP server: header (icon, name, status) + a single scrolling page with
 * the connection and tools sections stacked. Hydrated from a server-side `getBySlug` fetch; mutations
 * invalidate both `mcp.getBySlug` and the ExtensionsContext so the builder catalog stays in sync.
 */
export function McpServerDetail({ initialServer }: { initialServer: McpDetailServer }) {
  const router = useRouter()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const { refreshMcpServers } = useExtensionsContext()
  const { data: server } = api.mcp.getBySlug.useQuery(
    { slug: initialServer.slug },
    { initialData: initialServer }
  )
  const current = server ?? initialServer

  const remove = api.mcp.delete.useMutation()

  const onChanged = useCallback(async () => {
    await Promise.all([
      utils.mcp.getBySlug.invalidate({ slug: current.slug }),
      utils.mcp.list.invalidate(),
      refreshMcpServers(),
    ])
  }, [utils, current.slug, refreshMcpServers])

  async function handleRemove() {
    const ok = await confirm({
      title: 'Uninstall MCP server?',
      description: 'Agents using its tools will lose them.',
      confirmText: 'Uninstall',
      destructive: true,
    })
    if (!ok) return
    try {
      await remove.mutateAsync({ serverId: current.serverId })
      await onChanged()
      router.push('/app/settings/apps')
    } catch (err) {
      toastError({
        title: 'Failed to uninstall server',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return (
    <SettingsPage
      icon={
        <div className='size-10 rounded-xl border flex items-center justify-center overflow-hidden'>
          {current.iconUrl ? (
            <AppIcon iconId={current.iconUrl} size='md' />
          ) : (
            <Plug className='size-5 text-muted-foreground' />
          )}
        </div>
      }
      title={
        <div className='flex items-center gap-2'>
          <span>{current.name}</span>
          <McpStatusPill
            connectionPresent={current.connectionPresent}
            needsReconnect={current.needsReconnect}
            lastSyncError={current.lastSyncError}
          />
        </div>
      }
      description={current.isCustom ? 'Custom server' : 'Curated server'}
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Apps', href: '/app/settings/apps' },
        { title: current.name },
      ]}
      button={
        <Button
          variant='destructive'
          size='sm'
          onClick={handleRemove}
          loading={remove.isPending}
          loadingText='Uninstalling...'>
          <Trash2 />
          Uninstall
        </Button>
      }>
      <div className='flex flex-col flex-1 gap-8 p-6'>
        <McpServerConnectionTab server={current} onChanged={onChanged} />
        <McpServerToolsTab server={current} onChanged={onChanged} />
      </div>
      <ConfirmDialog />
    </SettingsPage>
  )
}
