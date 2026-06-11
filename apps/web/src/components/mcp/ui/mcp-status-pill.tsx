// apps/web/src/components/mcp/ui/mcp-status-pill.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, CheckCircle2, Plug, RefreshCw } from 'lucide-react'

export interface McpStatusInput {
  connectionPresent: boolean
  needsReconnect?: boolean
  lastSyncError: string | null
}

type McpStatus = 'connected' | 'needs_reconnect' | 'sync_error' | 'not_connected'

/** Derive the single display status from a server's connection + sync state. */
export function mcpStatus({
  connectionPresent,
  needsReconnect,
  lastSyncError,
}: McpStatusInput): McpStatus {
  if (!connectionPresent) return 'not_connected'
  if (needsReconnect) return 'needs_reconnect'
  if (lastSyncError) return 'sync_error'
  return 'connected'
}

const STATUS_META: Record<McpStatus, { label: string; icon: typeof Plug; className: string }> = {
  connected: {
    label: 'Connected',
    icon: CheckCircle2,
    className: 'text-green-600 border-green-200 bg-green-50',
  },
  needs_reconnect: {
    label: 'Needs reconnect',
    icon: RefreshCw,
    className: 'text-amber-600 border-amber-200 bg-amber-50',
  },
  sync_error: {
    label: 'Sync error',
    icon: AlertTriangle,
    className: 'text-red-600 border-red-200 bg-red-50',
  },
  not_connected: {
    label: 'Not connected',
    icon: Plug,
    className: 'text-muted-foreground border-border bg-primary-50',
  },
}

/** Small connection-status pill shown on MCP cards + the detail page. */
export function McpStatusPill(props: McpStatusInput & { className?: string }) {
  const status = mcpStatus(props)
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
        meta.className,
        props.className
      )}>
      <Icon className='size-3' />
      {meta.label}
    </span>
  )
}
