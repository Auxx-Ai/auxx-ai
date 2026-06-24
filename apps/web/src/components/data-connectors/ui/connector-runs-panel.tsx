// apps/web/src/components/data-connectors/ui/connector-runs-panel.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ButtonGroup, ButtonGroupSeparator } from '@auxx/ui/components/button-group'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { EntityIcon } from '@auxx/ui/components/icons'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { pluralize } from '@auxx/utils/strings'
import { ArchiveX, History, Plus, RefreshCw, SkipForward, Trash2, XCircle } from 'lucide-react'
import { Fragment, useState } from 'react'
import { VisualIcon } from '~/components/icons/ui/visual-icon'
import { api, type RouterOutputs } from '~/trpc/react'
import { ConnectorBackfillProgress } from './connector-backfill-progress'
import { ConnectorFreshnessPanel } from './connector-freshness-panel'
import { ConnectorRunErrors } from './connector-run-errors'
import { asRunStatus, type ConnectorStatus, RUN_STATUS_META } from './connector-status'

/** A single row in the `listRuns` history. */
type ConnectorRun = RouterOutputs['dataConnector']['listRuns'][number]

interface ConnectorRunsPanelProps {
  connectorId: string
  initialStatus: ConnectorStatus
  /** The source name, shown on the live "Importing from …" backfill card. */
  sourceLabel: string
}

/** The per-run delta counts, in render order. Each maps to a numeric field on the run. */
const COUNT_FIELDS = [
  { key: 'created', icon: Plus, label: 'Created', className: 'text-green-600' },
  { key: 'updated', icon: RefreshCw, label: 'Updated', className: 'text-blue-600' },
  { key: 'skipped', icon: SkipForward, label: 'Skipped', className: 'text-muted-foreground' },
  { key: 'archived', icon: ArchiveX, label: 'Archived', className: 'text-amber-600' },
  { key: 'deleted', icon: Trash2, label: 'Deleted', className: 'text-red-600' },
  { key: 'failed', icon: XCircle, label: 'Failed', className: 'text-red-600' },
] as const

/**
 * The run's nonzero deltas as a border-collapsed button group of `xs` segments
 * (icon + count). The text label ("Created", "Updated", …) is hidden by default
 * and only shows once the row's `@container/runs` is wide enough — so the cluster
 * stays compact in a narrow panel and spells itself out when there's room.
 */
function RunCounts({ run, className }: { run: ConnectorRun; className?: string }) {
  const segments = COUNT_FIELDS.filter((f) => run[f.key] > 0)
  if (segments.length === 0) return null
  return (
    <ButtonGroup className={className}>
      {segments.map((f, i) => {
        const Icon = f.icon
        return (
          <Fragment key={f.key}>
            {i > 0 && <ButtonGroupSeparator />}
            <Button
              size='xs'
              variant='outline'
              tabIndex={-1}
              title={f.label}
              className={cn('text-[11px] font-normal', f.className)}>
              <Icon />
              <span className='hidden @md/runs:inline'>{f.label}</span>
              {run[f.key]}
            </Button>
          </Fragment>
        )
      })}
    </ButtonGroup>
  )
}

/**
 * A single run in the history list, as an expandable tree row: a colored status
 * icon + label, the per-run count chips inline, the trigger/mode/duration in the
 * help-icon tooltip, the relative start time on the right, and an expandable
 * error-sample block — the chevron only appears when the run carries errors.
 */
function RunRow({ run, sourceLabel }: { run: ConnectorRun; sourceLabel: string }) {
  const [open, setOpen] = useState(false)
  const meta = RUN_STATUS_META[asRunStatus(run.status)]
  const errors = run.errorSample ?? []
  const hasErrors = errors.length > 0

  const metaParts = [run.trigger, run.mode]
  // A sample run self-documents via its `sampleLimit` (trial-sync §4.1) — surface it so
  // a parked `partial` row reads as a deliberate sample, not a failure.
  if (run.sampleLimit != null) metaParts.push(`sample ${run.sampleLimit}`)
  if (run.durationMs != null) metaParts.push(formatDuration(run.durationMs))

  return (
    <TreeRow
      icon={<VisualIcon value={`icon:${meta.iconId}:${meta.color}`} size='sm' />}
      title={meta.label}
      description={metaParts.join(' · ')}
      rowClassName='hover:bg-primary-100'
      secondary={<RunCounts run={run} className='ms-2' />}
      actions={
        <div className='flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground'>
          {run.relationshipWarnings > 0 && (
            <span className='text-amber-600'>
              {run.relationshipWarnings} {pluralize(run.relationshipWarnings, 'warning')}
            </span>
          )}
          <LastUpdated timestamp={new Date(run.startedAt)} />
        </div>
      }
      expandable={hasErrors}
      isOpen={hasErrors ? open : undefined}
      onToggleOpen={hasErrors ? () => setOpen((v) => !v) : undefined}>
      {hasErrors && (
        <div className='mt-1 me-2 ms-8 flex flex-col gap-1 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700'>
          {errors.slice(0, 3).map((e, i) => (
            <div key={i} className='truncate'>
              <span className='font-mono'>{e.externalId}</span>: {e.error}
            </div>
          ))}
          <ConnectorRunErrors errors={errors} connectorLabel={sourceLabel} runId={run.id} />
        </div>
      )}
    </TreeRow>
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
  // Webhook syncs never stamp `lastSyncedAt`, so a webhook delivery counts as freshness
  // too — else a live webhook-sync connector would show no freshness panel at all (§9).
  const lastWebhookEventAt = statusQuery.data?.lastWebhookEventAt ?? null
  const showFreshness = !showBackfill && (!!lastSyncedAt || !!lastWebhookEventAt)

  return (
    <div className='flex flex-1 min-h-0 flex-col bg-background'>
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
          sampleLimit={latestRun?.sampleLimit}
        />
      )}

      {showFreshness && (
        <ConnectorFreshnessPanel
          lastSyncedAt={lastSyncedAt}
          lastWebhookEventAt={lastWebhookEventAt}
          nextSyncAt={statusQuery.data?.nextSyncAt ?? null}
          cadenceLabel={statusQuery.data?.cadenceLabel ?? null}
          syncBehavior={statusQuery.data?.syncBehavior ?? 'manual'}
          latestRun={latestRun}
        />
      )}

      <ScrollArea className='flex-1' scrollbarClassName='w-1.5'>
        <Section
          title='History'
          icon={<History className='size-4' />}
          className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'
          initialOpen
          collapsible={false}>
          {rows.length === 0 ? (
            <div className='px-3 py-2'>
              <EmptySection
                icon={<History className='size-5' />}
                title='No runs yet'
                description='Use “Sync now” to run this connector.'
              />
            </div>
          ) : (
            <div className='@container/runs flex flex-col ps-2 pe-4'>
              {rows.map((run) => (
                <RunRow key={run.id} run={run} sourceLabel={sourceLabel} />
              ))}
            </div>
          )}
        </Section>
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
