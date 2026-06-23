// apps/web/src/components/data-connectors/ui/connector-freshness-panel.tsx
'use client'

import { LastUpdated } from '@auxx/ui/components/last-updated'

interface ConnectorFreshnessPanelProps {
  lastSyncedAt: Date | string | null
  /** Derived next-sync ISO (scheduled only); null for manual/webhook/custom-cron. */
  nextSyncAt: string | null
  /** Human cadence, e.g. "every 15 minutes". */
  cadenceLabel: string | null
  /** 'manual' | 'scheduled' | 'webhook'. */
  syncBehavior: string
  latestRun?: { created?: number; updated?: number } | null
}

/**
 * The steady-phase freshness panel (Step 9 §10.3) — a non-programmer's "is this up to
 * date?" at a glance: last/next synced, the latest run's delta, and how it keeps fresh.
 * Shown between runs (not during a backfill — that's the import card). All relative
 * times self-update via `LastUpdated`; nothing here is a cursor or a percent.
 */
export function ConnectorFreshnessPanel({
  lastSyncedAt,
  nextSyncAt,
  cadenceLabel,
  syncBehavior,
  latestRun,
}: ConnectorFreshnessPanelProps) {
  const created = latestRun?.created ?? 0
  const updated = latestRun?.updated ?? 0
  const delta = created > 0 || updated > 0 ? `+${updated} updated, +${created} new` : 'No changes'

  return (
    <div className='grid grid-cols-2 gap-x-4 gap-y-2 border-b bg-muted/30 px-4 py-3 text-xs'>
      <Cell label='Last synced'>
        {lastSyncedAt ? <LastUpdated timestamp={lastSyncedAt} className='text-xs' /> : '—'}
      </Cell>
      <Cell label='Synced this run'>{delta}</Cell>

      <Cell label='Next sync'>{nextSync(nextSyncAt, syncBehavior, cadenceLabel)}</Cell>
      <Cell label='Keeping up to date'>{cadence(syncBehavior, cadenceLabel)}</Cell>
    </div>
  )
}

/** The "Next sync" value — a relative time when scheduled, else the trigger model. */
function nextSync(nextSyncAt: string | null, syncBehavior: string, cadenceLabel: string | null) {
  if (nextSyncAt) return <LastUpdated timestamp={nextSyncAt} className='text-xs' />
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

/** A labeled value cell (muted label over the value). */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-[11px] text-muted-foreground'>{label}</span>
      <span className='text-foreground'>{children}</span>
    </div>
  )
}
