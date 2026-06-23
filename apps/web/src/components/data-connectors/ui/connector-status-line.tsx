// apps/web/src/components/data-connectors/ui/connector-status-line.tsx
'use client'

import { LastUpdated } from '@auxx/ui/components/last-updated'
import { cn } from '@auxx/ui/lib/utils'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  PauseCircle,
  RefreshCw,
  Wrench,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  resolveSyncStatus,
  type SyncStatusRunInfo,
  type SyncStatusState,
} from '../lib/resolve-sync-status'
import type { ConnectorStatus } from './connector-status'

/** Per-state icon + text color for the status-line chip. */
const STATE_META: Record<
  SyncStatusState,
  { icon: React.ComponentType<{ className?: string }>; className: string; spin?: boolean }
> = {
  synced: { icon: CheckCircle2, className: 'text-green-600' },
  syncing: { icon: RefreshCw, className: 'text-amber-600', spin: true },
  'rate-limited': { icon: Clock, className: 'text-amber-600' },
  paused: { icon: PauseCircle, className: 'text-muted-foreground' },
  'action-needed': { icon: AlertTriangle, className: 'text-amber-600' },
  error: { icon: XCircle, className: 'text-red-600' },
  idle: { icon: Wrench, className: 'text-muted-foreground' },
}

interface ConnectorStatusLineProps {
  /** Live connector status (polled `getStatus`, falling back to the row value). */
  status: ConnectorStatus
  error?: string | null
  lastSyncedAt?: Date | string | null
  latestRun?: SyncStatusRunInfo | null
  className?: string
}

/**
 * The at-a-glance, freshness-first status line for the connector detail header
 * (Step 9 §10.1) — replaces `ConnectorStatusPill`. A state chip (icon + label) plus a
 * concise secondary line: live import counts while syncing, a self-healing countdown
 * while rate-limited, or "last synced …" when idle. Honest copy only — never a fake
 * percent. Actions (Sync / Pause / Reconnect) live in the header, not here.
 */
export function ConnectorStatusLine({
  status,
  error,
  lastSyncedAt,
  latestRun,
  className,
}: ConnectorStatusLineProps) {
  const resolved = resolveSyncStatus({ status, error, latestRun })
  const meta = STATE_META[resolved.state]
  const Icon = meta.icon

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2 text-xs', className)}>
      <span className={cn('inline-flex shrink-0 items-center gap-1 font-medium', meta.className)}>
        <Icon className={cn('size-3.5', meta.spin && 'animate-spin')} />
        {resolved.label}
      </span>
      <SecondaryLine
        state={resolved.state}
        detail={resolved.detail}
        countdownUntil={resolved.countdownUntil}
        lastSyncedAt={lastSyncedAt}
      />
    </span>
  )
}

/** The muted secondary copy — composed per state so the live countdown can interleave. */
function SecondaryLine({
  state,
  detail,
  countdownUntil,
  lastSyncedAt,
}: {
  state: SyncStatusState
  detail: string
  countdownUntil?: string
  lastSyncedAt?: Date | string | null
}) {
  if (state === 'rate-limited' && countdownUntil) {
    return (
      <span className='truncate text-muted-foreground'>
        Waiting for the source · retrying in <Countdown until={countdownUntil} /> (auto-resumes)
      </span>
    )
  }

  // Synced → freshness ("last synced 4 min ago"); the per-run delta + "next in …"
  // line is the steady-freshness panel (Step 9 Phase 3), not this compact line.
  if (state === 'synced' && lastSyncedAt) {
    return (
      <LastUpdated className='truncate text-xs' timestamp={lastSyncedAt} prefix='Last synced' />
    )
  }

  return <span className='truncate text-muted-foreground'>{detail}</span>
}

/** A 1s-ticking "m:ss" countdown toward `until`; clamps at 0:00 (pure client, no fetch). */
function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const target = new Date(until).getTime()
    if (Number.isNaN(target)) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [until])

  const remainingMs = Math.max(0, new Date(until).getTime() - now)
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return (
    <span className='tabular-nums'>
      {minutes}:{String(seconds).padStart(2, '0')}
    </span>
  )
}
