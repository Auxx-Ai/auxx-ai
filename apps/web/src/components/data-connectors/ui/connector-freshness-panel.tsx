// apps/web/src/components/data-connectors/ui/connector-freshness-panel.tsx
'use client'

import { LastUpdated } from '@auxx/ui/components/last-updated'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { ArrowDownUp, CalendarClock, History, RefreshCw } from 'lucide-react'
import { describeHistoryFrom } from '../lib/format-history'

/** How far back one stream's last backfill reached (`getStatus.perStream`). */
export interface StreamCoverage {
  streamKey: string
  /** ISO; null = everything, undefined = not recorded. */
  coverageFrom?: string | null
  /** Set when the history limit ended that backfill. */
  stoppedAtRecords?: number | null
}

interface ConnectorFreshnessPanelProps {
  lastSyncedAt: Date | string | null
  /** Last processed webhook delivery — the liveness signal for webhook-sync connectors,
   *  which open no run and never stamp `lastSyncedAt` (sync-bridge §9). */
  lastWebhookEventAt?: Date | string | null
  /** Derived next-sync ISO (scheduled only); null for manual/webhook/custom-cron. */
  nextSyncAt: string | null
  /** Human cadence, e.g. "every 15 minutes". */
  cadenceLabel: string | null
  /** 'manual' | 'scheduled' | 'webhook'. */
  syncBehavior: string
  latestRun?: { created?: number; updated?: number } | null
  /** Per-stream history reach; streams without a recorded coverage are left out. */
  coverage?: StreamCoverage[]
}

/**
 * The steady-phase freshness panel (Step 9 §10.3) — a non-programmer's "is this up to
 * date?" at a glance: last/next synced, the latest run's delta, and how it keeps fresh.
 * Rendered with the shared `MetricGrid` widget (matching the document/file/ticket detail
 * drawers) as a 2×2 grid. Shown between runs (not during a backfill — that's the import
 * card). All relative times self-update via `LastUpdated`; nothing here is a cursor or a
 * percent.
 */
export function ConnectorFreshnessPanel({
  lastSyncedAt,
  lastWebhookEventAt,
  nextSyncAt,
  cadenceLabel,
  syncBehavior,
  latestRun,
  coverage = [],
}: ConnectorFreshnessPanelProps) {
  const created = latestRun?.created ?? 0
  const updated = latestRun?.updated ?? 0
  const delta = created > 0 || updated > 0 ? `+${updated} updated, +${created} new` : 'No changes'

  // Webhook syncs open no run, so "Last synced" lives in `lastWebhookEventAt`; relabel
  // the cell "Last event" for them and fall back to a bulk sync only if older/absent.
  const isWebhook = syncBehavior === 'webhook'
  const freshnessLabel = isWebhook ? 'Last event' : 'Last synced'
  const freshnessAt = isWebhook ? (lastWebhookEventAt ?? lastSyncedAt) : lastSyncedAt

  const reached = coverage.filter((s) => s.coverageFrom !== undefined)

  return (
    <>
      <MetricGrid columns={2}>
        <MetricCell
          label={freshnessLabel}
          icon={<History className='size-4 text-muted-foreground' />}
          value={freshnessAt ? <LastUpdated timestamp={freshnessAt} className='text-sm' /> : '—'}
        />
        <MetricCell
          label='Synced this run'
          icon={<ArrowDownUp className='size-4 text-muted-foreground' />}
          value={delta}
        />
        <MetricCell
          label='Next sync'
          icon={<CalendarClock className='size-4 text-muted-foreground' />}
          value={nextSync(nextSyncAt, syncBehavior, cadenceLabel)}
        />
        <MetricCell
          label='Keeping up to date'
          icon={<RefreshCw className='size-4 text-muted-foreground' />}
          value={cadence(syncBehavior, cadenceLabel)}
        />
      </MetricGrid>
      {reached.length > 0 && (
        <div className='flex flex-col gap-0.5 border-b px-4 py-2 text-[11px] text-muted-foreground'>
          {reached.map((s) => (
            <div key={s.streamKey} className='flex min-w-0 gap-1.5'>
              <span className='shrink-0 capitalize text-foreground'>
                {s.streamKey || 'Records'}
              </span>
              <span className='truncate'>
                {describeHistoryFrom(s.coverageFrom ?? null)}
                {s.stoppedAtRecords ? ` · stopped at ${s.stoppedAtRecords.toLocaleString()}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** The "Next sync" value — a relative time when scheduled, else the trigger model. */
function nextSync(nextSyncAt: string | null, syncBehavior: string, cadenceLabel: string | null) {
  if (nextSyncAt) return <LastUpdated timestamp={nextSyncAt} className='text-sm' />
  if (syncBehavior === 'webhook') return 'On changes'
  if (syncBehavior === 'manual') return 'On demand'
  // Scheduled but no derivable next-time (custom cron).
  return cadenceLabel ?? 'Not scheduled'
}

/** The freshness-source subtitle. */
function cadence(syncBehavior: string, cadenceLabel: string | null): string {
  if (syncBehavior === 'webhook') return 'Live via webhooks'
  if (syncBehavior === 'manual') return 'Syncs when you run it'
  return cadenceLabel ?? 'Not scheduled'
}
