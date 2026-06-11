// apps/web/src/components/mcp/ui/mcp-server-tools-tab.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { ToggleCard } from '@auxx/ui/components/toggle-card'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { AlertTriangle, Pencil, RefreshCw, ShieldCheck, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import type { McpDetailServer } from './mcp-server-detail'

interface McpServerToolsTabProps {
  server: McpDetailServer
  onChanged: () => void
}

/**
 * Tools section: a flat list of the server's tools with a persistent trust `Switch` per row
 * (trusted tools run without approval), a read/write hint, a "Trust all" toggle, and a Refresh
 * button that re-snapshots `tools/list`. Stale `lastSyncError` surfaces as a banner.
 */
export function McpServerToolsTab({ server, onChanged }: McpServerToolsTabProps) {
  const update = api.mcp.update.useMutation()
  const refresh = api.mcp.refreshTools.useMutation()

  // Local trust state seeded from the snapshot; the mutation result + onChanged refetch reconciles.
  const initialTrusted = useMemo(
    () => new Set(server.tools.filter((t) => t.trusted).map((t) => t.name)),
    [server.tools]
  )
  const [trusted, setTrusted] = useState<Set<string>>(initialTrusted)
  const allTrusted = server.tools.length > 0 && server.tools.every((t) => trusted.has(t.name))

  async function persist(next: { allTools?: boolean; tools?: string[] }) {
    try {
      await update.mutateAsync({ serverId: server.serverId, trust: next })
      onChanged()
    } catch (err) {
      setTrusted(initialTrusted) // revert
      toastError({
        title: 'Failed to update trust',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  function toggleTool(name: string, on: boolean) {
    const next = new Set(trusted)
    if (on) next.add(name)
    else next.delete(name)
    setTrusted(next)
    void persist({ tools: [...next] })
  }

  function toggleAll(on: boolean) {
    if (on) {
      setTrusted(new Set(server.tools.map((t) => t.name)))
      void persist({ allTools: true })
    } else {
      setTrusted(new Set())
      void persist({ tools: [] })
    }
  }

  async function handleRefresh() {
    try {
      const result = await refresh.mutateAsync({ serverId: server.serverId })
      if (!result.ok) {
        toastError({ title: 'Refresh failed', description: result.error ?? 'Unknown error' })
      }
      onChanged()
    } catch (err) {
      toastError({
        title: 'Refresh failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2 tracking-tight font-semibold text-foreground text-base'>
          <Wrench className='size-4' />
          Tools
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={handleRefresh}
          loading={refresh.isPending}
          loadingText='Refreshing...'>
          <RefreshCw />
          Refresh
        </Button>
      </div>

      <div className='text-sm text-muted-foreground'>
        {server.tools.length} {server.tools.length === 1 ? 'tool' : 'tools'}
        {server.lastSyncedAt
          ? ` · synced ${new Date(server.lastSyncedAt).toLocaleString()}`
          : ' · not synced yet'}
      </div>

      {server.lastSyncError && (
        <div className='flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700'>
          <AlertTriangle className='mt-0.5 size-4 shrink-0' />
          <div>
            <div className='font-medium'>Last sync failed</div>
            <div className='text-red-600'>{server.lastSyncError}</div>
          </div>
        </div>
      )}

      <ToggleCard
        title='Trust all tools'
        description='Trusted tools run without approval. Which agents get the tools is configured per agent.'
        icon={<ShieldCheck className='size-3.5' />}
        checked={allTrusted}
        onCheckedChange={toggleAll}
        disabled={update.isPending || server.tools.length === 0}
        switchSize='sm'
        className='bg-primary-50'
      />

      <div className='flex flex-col gap-0.5'>
        {server.tools.length === 0 ? (
          <div className='p-4 text-center text-sm text-muted-foreground'>
            No tools — connect and refresh to populate the list.
          </div>
        ) : (
          server.tools.map((tool) => (
            <TreeRow
              rowClassName='bg-primary-100/50 hover:bg-primary-100'
              key={tool.name}
              icon={<Wrench className='size-4 text-muted-foreground' />}
              title={tool.title ?? tool.name}
              description={tool.description}
              onToggleOpen={() => toggleTool(tool.name, !trusted.has(tool.name))}
              secondary={
                <Badge
                  variant='outline'
                  size='xs'
                  title={
                    tool.readOnlyHint
                      ? 'Read-only tool'
                      : 'Write tool — requires approval unless trusted'
                  }>
                  {tool.readOnlyHint ? 'Read' : <Pencil className='size-2.5' />}
                  {tool.readOnlyHint ? '' : 'Write'}
                </Badge>
              }
              actions={
                <Switch
                  size='xs'
                  checked={trusted.has(tool.name)}
                  onCheckedChange={(on) => toggleTool(tool.name, on)}
                  disabled={update.isPending}
                />
              }
            />
          ))
        )}
      </div>
    </div>
  )
}
