// apps/web/src/components/data-connectors/ui/connector-runs-panel.tsx
'use client'

import { Alert } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ButtonGroup, ButtonGroupSeparator } from '@auxx/ui/components/button-group'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { EntityIcon } from '@auxx/ui/components/icons'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { pluralize } from '@auxx/utils/strings'
import { ArchiveX, History, Plus, RefreshCw, SkipForward, Trash2, XCircle } from 'lucide-react'
import { Fragment, useState } from 'react'
import { VisualIcon } from '~/components/icons/ui/visual-icon'
import { api, type RouterOutputs } from '~/trpc/react'
import { useConnectorSyncRealtime } from '../hooks/use-connector-sync-realtime'
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
              <span className='hidden @lg/runs:inline'>{f.label}</span>
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
      secondary={
        <div className='ms-2 flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground'>
          <LastUpdated timestamp={new Date(run.startedAt)} />
          {run.relationshipWarnings > 0 && (
            <span className='text-amber-600'>
              {run.relationshipWarnings} {pluralize(run.relationshipWarnings, 'warning')}
            </span>
          )}
        </div>
      }
      actions={<RunCounts run={run} />}
      expandable={hasErrors}
      isOpen={hasErrors ? open : undefined}
      onToggleOpen={hasErrors ? () => setOpen((v) => !v) : undefined}>
      {hasErrors && (
        <Alert
          variant='destructive'
          className='mt-1 me-2 ms-8 flex w-auto flex-col items-start gap-1 text-xs'>
          {errors.slice(0, 3).map((e, i) => (
            <div key={i} className='break-words'>
              {e.error}
            </div>
          ))}
          <ConnectorRunErrors errors={errors} connectorLabel={sourceLabel} runId={run.id} />
        </Alert>
      )}
    </TreeRow>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// DEV-ONLY UI mock. Flip `MOCK_SCENARIO` away from 'off' to render the Runs drawer
// against canned synced data without standing up a real connector + sync. Lets
// us iterate on the freshness / backfill / run-history layout. DELETE before
// shipping — nothing here is reachable when the scenario is 'off'.
//   • 'live'     → steady state: freshness panel + a rich run history
//   • 'backfill' → first import in flight (unknown total)
//   • 'sampling' → trial sample run in flight (known denominator)
// ──────────────────────────────────────────────────────────────────────────
const MOCK_SCENARIO: 'off' | 'live' | 'backfill' | 'sampling' = 'off'

type StatusData = RouterOutputs['dataConnector']['getStatus']

/** Build one fake run row, filling every required column so the fixture stays terse. */
function mockRun(partial: Partial<ConnectorRun> & { id: string }): ConnectorRun {
  return {
    dataConnectorId: 'mock-connector',
    organizationId: 'mock-org',
    trigger: 'manual',
    mode: 'incremental',
    status: 'completed',
    phase: 'steady',
    sampleLimit: null,
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    archived: 0,
    deleted: 0,
    failed: 0,
    relationshipWarnings: 0,
    pagesProcessed: 1,
    rateLimitWaitMs: 0,
    errorSample: null,
    progress: null,
    chainSnapshot: null,
    cursorBefore: null,
    cursorAfter: null,
    startedAt: new Date(),
    heartbeatAt: new Date(),
    finishedAt: new Date(),
    durationMs: 1200,
    ...partial,
  } as ConnectorRun
}

/** Relative timestamp helper for the fixtures (N ms ago). */
const ago = (ms: number) => new Date(Date.now() - ms)

/** Canned `getStatus` + `listRuns` data per scenario, shaped exactly like the queries. */
function buildMockData(scenario: Exclude<typeof MOCK_SCENARIO, 'off'>): {
  status: StatusData
  runs: ConnectorRun[]
} {
  if (scenario === 'backfill' || scenario === 'sampling') {
    const sampleLimit = scenario === 'sampling' ? 500 : null
    const perStream = [
      {
        streamKey: 'customers',
        recordsSeen: scenario === 'sampling' ? 500 : 1840,
        phase: 'steady' as const,
        done: true,
      },
      {
        streamKey: 'orders',
        recordsSeen: scenario === 'sampling' ? 312 : 6204,
        phase: 'backfill' as const,
        done: false,
      },
      {
        streamKey: 'products',
        recordsSeen: scenario === 'sampling' ? 88 : 742,
        phase: 'backfill' as const,
        done: false,
      },
    ]
    const recordsSeen = perStream.reduce((n, s) => n + s.recordsSeen, 0)
    return {
      status: {
        status: 'syncing',
        syncBehavior: 'scheduled',
        lastSyncedAt: null,
        lastWebhookEventAt: null,
        itemCount: recordsSeen,
        error: null,
        resyncPending: null,
        nextSyncAt: null,
        cadenceLabel: 'every 15 minutes',
        latestRun: {
          id: 'mock-run-live',
          status: 'running',
          phase: 'backfill',
          trigger: 'manual',
          mode: 'snapshot',
          recordsSeen,
          created: 0,
          updated: 0,
          startedAt: ago(42_000),
          finishedAt: null,
          rateLimitedUntil: null,
          pausedReason: null,
          sampleLimit,
          primaryStreamLabel: 'orders',
        },
        perStream,
      } as StatusData,
      runs: [
        mockRun({
          id: 'mock-run-live',
          status: 'running',
          phase: 'backfill',
          mode: 'snapshot',
          sampleLimit,
          startedAt: ago(42_000),
          finishedAt: null,
          durationMs: null,
        }),
      ],
    }
  }

  // 'live' — steady state with a rich history.
  return {
    status: {
      status: 'live',
      syncBehavior: 'scheduled',
      lastSyncedAt: ago(8 * 60_000),
      lastWebhookEventAt: null,
      itemCount: 8786,
      error: null,
      resyncPending: null,
      nextSyncAt: new Date(Date.now() + 7 * 60_000).toISOString(),
      cadenceLabel: 'every 15 minutes',
      latestRun: {
        id: 'mock-run-1',
        status: 'completed',
        phase: 'steady',
        trigger: 'scheduled',
        mode: 'incremental',
        recordsSeen: 124,
        created: 12,
        updated: 38,
        startedAt: ago(8 * 60_000),
        finishedAt: ago(8 * 60_000 - 4200),
        rateLimitedUntil: null,
        pausedReason: null,
        sampleLimit: null,
        primaryStreamLabel: 'orders',
      },
      perStream: [
        { streamKey: 'customers', recordsSeen: 1840, phase: 'steady', done: true },
        { streamKey: 'orders', recordsSeen: 6204, phase: 'steady', done: true },
        { streamKey: 'products', recordsSeen: 742, phase: 'steady', done: true },
      ],
    } as StatusData,
    runs: [
      mockRun({
        id: 'mock-run-1',
        trigger: 'scheduled',
        created: 12,
        updated: 38,
        skipped: 70,
        fetched: 124,
        startedAt: ago(8 * 60_000),
        finishedAt: ago(8 * 60_000 - 4200),
        durationMs: 4200,
      }),
      mockRun({
        id: 'mock-run-2',
        trigger: 'scheduled',
        updated: 5,
        skipped: 119,
        fetched: 124,
        relationshipWarnings: 2,
        startedAt: ago(23 * 60_000),
        durationMs: 3100,
      }),
      mockRun({
        id: 'mock-run-3',
        trigger: 'manual',
        status: 'partial',
        phase: 'backfill',
        mode: 'snapshot',
        sampleLimit: 500,
        created: 488,
        skipped: 0,
        failed: 12,
        fetched: 500,
        startedAt: ago(2 * 3600_000),
        durationMs: 18400,
        errorSample: [
          { externalId: 'cust_8812', error: 'Missing required field: email', tier: 'invalid' },
          { externalId: 'cust_9043', error: 'Address line exceeds 255 chars', tier: 'rejected' },
          {
            externalId: 'cust_9101',
            error: 'Phone number failed E.164 validation',
            tier: 'invalid',
          },
        ],
      }),
      mockRun({
        id: 'mock-run-4',
        trigger: 'scheduled',
        status: 'failed',
        updated: 0,
        fetched: 0,
        failed: 1,
        startedAt: ago(5 * 3600_000),
        durationMs: 900,
        errorSample: [{ externalId: '', error: 'Upstream returned 503 Service Unavailable' }],
      }),
      mockRun({
        id: 'mock-run-5',
        trigger: 'manual',
        mode: 'snapshot',
        phase: 'backfill',
        created: 8786,
        fetched: 8786,
        startedAt: ago(26 * 3600_000),
        durationMs: 142000,
      }),
      mockRun({
        id: 'mock-run-6',
        trigger: 'scheduled',
        updated: 3,
        skipped: 121,
        fetched: 124,
        startedAt: ago(27 * 3600_000),
        durationMs: 2800,
      }),
      mockRun({
        id: 'mock-run-7',
        trigger: 'scheduled',
        updated: 1,
        skipped: 123,
        fetched: 124,
        startedAt: ago(28 * 3600_000),
        durationMs: 2600,
      }),
      mockRun({
        id: 'mock-run-8',
        trigger: 'scheduled',
        archived: 4,
        updated: 2,
        skipped: 118,
        fetched: 124,
        startedAt: ago(29 * 3600_000),
        durationMs: 2900,
      }),
      mockRun({
        id: 'mock-run-9',
        trigger: 'scheduled',
        deleted: 1,
        updated: 6,
        skipped: 117,
        fetched: 124,
        startedAt: ago(30 * 3600_000),
        durationMs: 3050,
      }),
    ],
  }
}

/** How many runs render before the "Show more" row collapses the rest. */
const VISIBLE_RUN_LIMIT = 7

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
  // Live run progress + lifecycle via the `dataConnector:sync` feed (self-sufficient
  // so the panel updates even when docked without the detail view). The polls below
  // are a 15s safety net — realtime is best-effort with no missed-event replay.
  useConnectorSyncRealtime(connectorId)

  const statusQuery = api.dataConnector.getStatus.useQuery(
    { id: connectorId },
    {
      refetchInterval: (query) => {
        const s = query.state.data?.status ?? initialStatus
        return s === 'syncing' || s === 'provisioning' ? 15000 : false
      },
    }
  )
  // DEV-ONLY: when `MOCK_SCENARIO` is on, override the live query data so the panel
  // renders against canned synced data. No-op (and tree-shakeable) when it's 'off'.
  const mock = MOCK_SCENARIO === 'off' ? null : buildMockData(MOCK_SCENARIO)
  const statusData = mock?.status ?? statusQuery.data

  const status = statusData?.status ?? initialStatus
  const isSyncing = status === 'syncing' || status === 'provisioning'

  const runs = api.dataConnector.listRuns.useQuery(
    { id: connectorId, limit: 50 },
    { refetchInterval: isSyncing ? 15000 : false }
  )

  const rows = mock?.runs ?? runs.data ?? []

  // Live initial-backfill card (Step 9 §10.2): only while a backfill chain is in
  // flight. Steady runs use the per-run counts below; this is the "first import" view.
  const latestRun = statusData?.latestRun
  const perStream = statusData?.perStream ?? []
  const showBackfill = isSyncing && latestRun?.phase === 'backfill' && perStream.length > 0

  // Steady freshness summary (Step 9 §10.3): once the source has synced and isn't
  // mid-backfill, show last/next synced + the latest run's delta instead of the card.
  const lastSyncedAt = statusData?.lastSyncedAt ?? null
  // Webhook syncs never stamp `lastSyncedAt`, so a webhook delivery counts as freshness
  // too — else a live webhook-sync connector would show no freshness panel at all (§9).
  const lastWebhookEventAt = statusData?.lastWebhookEventAt ?? null
  const showFreshness = !showBackfill && (!!lastSyncedAt || !!lastWebhookEventAt)

  // Persist the per-stream breakdown after a run finishes (not mid-backfill) so the
  // sync result lingers instead of vanishing the instant the connector goes `live`.
  // Settled, solid state — sits above the freshness grid.
  const showCompletedSummary = !isSyncing && perStream.length > 0 && !!lastSyncedAt

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
              {statusData?.itemCount ?? 0} records
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

      {showCompletedSummary && (
        <ConnectorBackfillProgress
          sourceLabel={sourceLabel}
          perStream={perStream}
          completed
          syncedAt={lastSyncedAt}
        />
      )}

      {showFreshness && (
        <ConnectorFreshnessPanel
          lastSyncedAt={lastSyncedAt}
          lastWebhookEventAt={lastWebhookEventAt}
          nextSyncAt={statusData?.nextSyncAt ?? null}
          cadenceLabel={statusData?.cadenceLabel ?? null}
          syncBehavior={statusData?.syncBehavior ?? 'manual'}
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
            <TreeRowList
              items={rows}
              getKey={(run) => run.id}
              visibleLimit={VISIBLE_RUN_LIMIT}
              showMoreIcon={<History className='size-4' />}
              className='@container/runs ps-2 pe-4'
              renderRow={(run) => <RunRow run={run} sourceLabel={sourceLabel} />}
            />
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
