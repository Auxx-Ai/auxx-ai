// apps/web/src/components/data-connectors/ui/connector-status.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  PauseCircle,
  RefreshCw,
  Wrench,
} from 'lucide-react'

/** The DataConnector lifecycle status (mirrors `DataConnector.status`). */
export type ConnectorStatus =
  | 'pending'
  | 'ready'
  | 'provisioning'
  | 'syncing'
  | 'live'
  | 'error'
  | 'paused'

/** The DataConnectorRun status (mirrors `DataConnectorRun.status`). */
export type RunStatus = 'running' | 'completed' | 'partial' | 'failed'

interface StatusMeta {
  label: string
  /** Tailwind bg class for the small list-card status dot. */
  dot: string
  /** Pill icon + classes for the detail-page status pill. */
  icon: React.ComponentType<{ className?: string }>
  pill: string
  /** True while a sync is in flight (drives the 4s status poll). */
  active: boolean
}

export const CONNECTOR_STATUS_META: Record<ConnectorStatus, StatusMeta> = {
  pending: {
    label: 'Not set up',
    dot: 'bg-muted-foreground/40',
    icon: Wrench,
    pill: 'text-muted-foreground border-border bg-primary-50',
    active: false,
  },
  ready: {
    // Configured, never synced, scheduler-eligible — a positive, settled idle state,
    // visibly distinct from `live`'s solid green and `pending`'s grey.
    label: 'Ready',
    dot: 'bg-info',
    icon: CircleDashed,
    pill: 'text-info border-info/30 bg-info/10',
    active: false,
  },
  provisioning: {
    label: 'Provisioning',
    dot: 'bg-warning-500',
    icon: Loader2,
    pill: 'text-amber-600 border-amber-200 bg-amber-50',
    active: true,
  },
  syncing: {
    label: 'Syncing',
    dot: 'bg-warning-500',
    icon: RefreshCw,
    pill: 'text-amber-600 border-amber-200 bg-amber-50',
    active: true,
  },
  live: {
    label: 'Live',
    dot: 'bg-good-500',
    icon: CheckCircle2,
    pill: 'text-green-600 border-green-200 bg-green-50',
    active: false,
  },
  error: {
    label: 'Error',
    dot: 'bg-destructive',
    icon: AlertTriangle,
    pill: 'text-red-600 border-red-200 bg-red-50',
    active: false,
  },
  paused: {
    label: 'Paused',
    dot: 'bg-muted-foreground/40',
    icon: PauseCircle,
    pill: 'text-muted-foreground border-border bg-primary-50',
    active: false,
  },
}

/** A normalized status value (falls back to `pending` for unknown strings). */
export function asConnectorStatus(value: string | null | undefined): ConnectorStatus {
  return value && value in CONNECTOR_STATUS_META ? (value as ConnectorStatus) : 'pending'
}

/**
 * Run-status display meta for the Runs panel. Carries an `EntityIcon` registry
 * `iconId` + color token (consumed via `VisualIcon`) so run rows render the same
 * framed, colored icon as the rest of the connector trees.
 */
export const RUN_STATUS_META: Record<RunStatus, { label: string; iconId: string; color: string }> =
  {
    running: { label: 'Running', iconId: 'refresh', color: 'amber' },
    completed: { label: 'Completed', iconId: 'check-circle', color: 'green' },
    partial: { label: 'Partial', iconId: 'alert-triangle', color: 'amber' },
    failed: { label: 'Failed', iconId: 'x-circle', color: 'red' },
  }

/** A normalized run status (falls back to `completed` for unknown strings). */
export function asRunStatus(value: string | null | undefined): RunStatus {
  return value && value in RUN_STATUS_META ? (value as RunStatus) : 'completed'
}

/** Small colored status dot used on the list cards. */
export function ConnectorStatusDot({
  status,
  className,
}: {
  status: ConnectorStatus
  className?: string
}) {
  const meta = CONNECTOR_STATUS_META[status]
  return (
    <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground'>
      <span className={cn('size-2 rounded-full', meta.dot, className)} />
      {meta.label}
    </span>
  )
}

/**
 * Status pill for the detail-page header — same shape as `McpStatusPill`.
 * Spinning icon while syncing / provisioning.
 */
export function ConnectorStatusPill({
  status,
  className,
}: {
  status: ConnectorStatus
  className?: string
}) {
  const meta = CONNECTOR_STATUS_META[status]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
        meta.pill,
        className
      )}>
      <Icon className={cn('size-3', meta.active && 'animate-spin')} />
      {meta.label}
    </span>
  )
}
