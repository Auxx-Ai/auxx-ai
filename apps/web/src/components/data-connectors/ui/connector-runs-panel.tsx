// apps/web/src/components/data-connectors/ui/connector-runs-panel.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { EntityIcon } from '@auxx/ui/components/icons'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import {
  AlertTriangle,
  ArchiveX,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  SkipForward,
  Trash2,
  XCircle,
} from 'lucide-react'
import { api } from '~/trpc/react'
import { ConnectorBackfillProgress } from './connector-backfill-progress'
import { ConnectorFreshnessPanel } from './connector-freshness-panel'
import { ConnectorRunErrors } from './connector-run-errors'
import type { ConnectorStatus } from './connector-status'

interface ConnectorRunsPanelProps {
  connectorId: string
  initialStatus: ConnectorStatus
  /** The source name, shown on the live "Importing from …" backfill card. */
  sourceLabel: string
}

const RUN_STATUS_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  running: { label: 'Running', icon: Loader2, className: 'text-amber-600' },
  completed: { label: 'Completed', icon: CheckCircle2, className: 'text-green-600' },
  partial: { label: 'Partial', icon: AlertTriangle, className: 'text-amber-600' },
  failed: { label: 'Failed', icon: XCircle, className: 'text-red-600' },
}

/** A single count chip (icon + n) shown on a run row. */
function CountChip({
  icon: Icon,
  value,
  label,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: number
  label: string
  className?: string
}) {
  if (!value) return null
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}
      title={label}>
      <Icon className='size-3' />
      {value}
    </span>
  )
}

/**
 * Docked Runs panel: live sync status (polls `getStatus` every 4s while syncing,
 * matching the Knowledge-Sources cadence) + the `DataConnectorRun` history with
 * per-run created/updated/skipped/archived/deleted/failed counts, relationship
 * warnings, durations, cursor + error samples. Reuses execution-progress styling.
 * See plans/data-connectors/claude/05-frontend.md §6.
 */
export function ConnectorRunsPanel({
  connectorId,
  initialStatus,
  sourceLabel,
}: ConnectorRunsPanelProps) {
  const statusQuery = api.dataConnector.getStatus.useQuery(
    { id: connectorId },
    {
      refetchInterval: (query) => {
        const s = query.state.data?.status ?? initialStatus
        return s === 'syncing' || s === 'provisioning' ? 4000 : false
      },
    }
  )
  const status = statusQuery.data?.status ?? initialStatus
  const isSyncing = status === 'syncing' || status === 'provisioning'

  const runs = api.dataConnector.listRuns.useQuery(
    { id: connectorId, limit: 50 },
    { refetchInterval: isSyncing ? 4000 : false }
  )

  const rows = runs.data ?? []

  // Live initial-backfill card (Step 9 §10.2): only while a backfill chain is in
  // flight. Steady runs use the per-run counts below; this is the "first import" view.
  const latestRun = statusQuery.data?.latestRun
  const perStream = statusQuery.data?.perStream ?? []
  const showBackfill = isSyncing && latestRun?.phase === 'backfill' && perStream.length > 0

  // Steady freshness summary (Step 9 §10.3): once the source has synced and isn't
  // mid-backfill, show last/next synced + the latest run's delta instead of the card.
  const lastSyncedAt = statusQuery.data?.lastSyncedAt ?? null
  const showFreshness = !showBackfill && !!lastSyncedAt

  return (
    <div className='flex h-full flex-col bg-background'>
      <DrawerHeader
        icon={<EntityIcon iconId='history' color='gray' className='size-6' />}
        title='Runs'
        actions={
          isSyncing ? (
            <Badge variant='outline' size='sm' className='text-amber-600'>
              <RefreshCw className='size-3 animate-spin' />
              Syncing
            </Badge>
          ) : (
            <Badge variant='outline' size='sm'>
              {statusQuery.data?.itemCount ?? 0} records
            </Badge>
          )
        }
      />

      {showBackfill && (
        <ConnectorBackfillProgress
          sourceLabel={sourceLabel}
          startedAt={latestRun?.startedAt}
          perStream={perStream}
        />
      )}

      {showFreshness && (
        <ConnectorFreshnessPanel
          lastSyncedAt={lastSyncedAt}
          nextSyncAt={statusQuery.data?.nextSyncAt ?? null}
          cadenceLabel={statusQuery.data?.cadenceLabel ?? null}
          syncBehavior={statusQuery.data?.syncBehavior ?? 'manual'}
          latestRun={latestRun}
        />
      )}

      <ScrollArea className='flex-1' scrollbarClassName='w-1.5'>
        <div className='flex flex-col divide-y'>
          {rows.length === 0 ? (
            <div className='px-4 py-8 text-center text-xs text-muted-foreground'>
              No runs yet. Use “Sync now” to run this connector.
            </div>
          ) : (
            rows.map((run) => {
              const meta = RUN_STATUS_META[run.status] ?? RUN_STATUS_META.completed
              const Icon = meta!.icon
              return (
                <div key={run.id} className='flex flex-col gap-1.5 px-4 py-3'>
                  <div className='flex items-center justify-between'>
                    <span
                      className={cn('inline-flex items-center gap-1.5 text-sm', meta!.className)}>
                      <Icon className={cn('size-4', run.status === 'running' && 'animate-spin')} />
                      {meta!.label}
                    </span>
                    <span className='text-xs text-muted-foreground'>
                      <LastUpdated timestamp={new Date(run.startedAt)} />
                    </span>
                  </div>

                  <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                    <CountChip
                      icon={Plus}
                      value={run.created}
                      label='Created'
                      className='text-green-600'
                    />
                    <CountChip
                      icon={RefreshCw}
                      value={run.updated}
                      label='Updated'
                      className='text-blue-600'
                    />
                    <CountChip icon={SkipForward} value={run.skipped} label='Skipped' />
                    <CountChip
                      icon={ArchiveX}
                      value={run.archived}
                      label='Archived'
                      className='text-amber-600'
                    />
                    <CountChip
                      icon={Trash2}
                      value={run.deleted}
                      label='Deleted'
                      className='text-red-600'
                    />
                    <CountChip
                      icon={XCircle}
                      value={run.failed}
                      label='Failed'
                      className='text-red-600'
                    />
                  </div>

                  <div className='flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground'>
                    <span>
                      {run.trigger} · {run.mode}
                    </span>
                    {run.durationMs != null && <span>{formatDuration(run.durationMs)}</span>}
                    {run.relationshipWarnings > 0 && (
                      <span className='text-amber-600'>
                        {run.relationshipWarnings} relationship warning
                        {run.relationshipWarnings === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>

                  {run.errorSample && run.errorSample.length > 0 && (
                    <div className='mt-1 flex flex-col gap-1 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700'>
                      {run.errorSample.slice(0, 3).map((e, i) => (
                        <div key={i} className='truncate'>
                          <span className='font-mono'>{e.externalId}</span>: {e.error}
                        </div>
                      ))}
                      <ConnectorRunErrors
                        errors={run.errorSample}
                        connectorLabel={sourceLabel}
                        runId={run.id}
                      />
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}
