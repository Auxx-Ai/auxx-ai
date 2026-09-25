// apps/web/src/components/mrp/ui/runs/runs-page.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { CircleAlert, History } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { EMPTY_CELL } from '~/components/global/module-toolbar'
import { ReportGrid, type ReportTextColumn } from '~/components/global/report-grid/report-grid'
import type { ReportGridRow } from '~/components/global/report-grid/report-grid-layout'
import { ReportMessage, ReportPageLayout } from '~/components/global/report-grid/report-page-layout'
import { useAccess } from '~/providers/capabilities-provider'
import { api, type RouterOutputs } from '~/trpc/react'
import { useMrpRun } from '../../hooks/use-mrp-run'
import {
  formatMrpRunStarted,
  MrpRunNowButton,
  mrpAsOfHint,
  useMrpToolbar,
} from '../mrp-toolbar-actions'
import { formatQty } from '../rows/format'

type RunRow = RouterOutputs['mrp']['runs'][number]

const RUN_LIMIT = 200

const TEXT_COLUMNS: ReportTextColumn[] = [
  { key: 'status', label: 'Status', width: 120 },
  { key: 'duration', label: 'Duration', width: 90, align: 'right' },
  { key: 'parts', label: 'Parts planned', width: 110, align: 'right' },
  { key: 'overdue', label: 'Overdue', width: 90, align: 'right' },
  { key: 'flagged', label: 'Flagged', width: 90, align: 'right' },
  { key: 'error', label: 'Error', minWidth: 200 },
]

const STATUS_DISPLAY: Record<RunRow['status'], { dot: string; label: string }> = {
  completed: { dot: 'bg-green-500', label: 'completed' },
  failed: { dot: 'bg-red-500', label: 'failed' },
  running: { dot: 'bg-amber-500', label: 'running' },
}

/** "850 ms", "12.4 s", "3 m 05 s". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return EMPTY_CELL
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)} m ${String(whole % 60).padStart(2, '0')} s`
}

function figure(value: number, completed: boolean) {
  return (
    <span className='font-mono text-xs tabular-nums'>
      {completed ? formatQty(value) : EMPTY_CELL}
    </span>
  )
}

function toGridRow(run: RunRow): ReportGridRow {
  const status = STATUS_DISPLAY[run.status]
  const completed = run.status === 'completed'
  return {
    id: run.id,
    label: formatMrpRunStarted(run, 'MMM d, yyyy HH:mm'),
    depth: 0,
    kind: 'line',
    values: [],
    meta: {
      badge: run.isLatest ? (
        <Badge variant='outline' size='xs'>
          latest
        </Badge>
      ) : undefined,
    },
    cells: {
      status: (
        <span className='flex items-center gap-1.5 text-muted-foreground text-xs'>
          <span className={cn('size-1.5 shrink-0 rounded-full', status.dot)} aria-hidden />
          {status.label}
        </span>
      ),
      duration: (
        <span className='font-mono text-muted-foreground text-xs tabular-nums'>
          {formatDuration(run.durationMs)}
        </span>
      ),
      parts: figure(run.itemCount, completed),
      overdue: figure(run.overdueCount, completed),
      flagged: figure(run.flaggedCount, completed),
      error: run.error ? (
        <span className='text-destructive text-xs' title={run.error}>
          {run.error}
        </span>
      ) : null,
    },
  }
}

/** `/app/parts/manage/runs` (07 §4.4): every plan run, newest first; a completed row pins `?run=`. */
export function RunsPage() {
  const { runId, run, pin, clear } = useMrpRun()
  useMrpToolbar('Runs', mrpAsOfHint(run))
  const { can } = useAccess()

  const runs = api.mrp.runs.useQuery({ limit: RUN_LIMIT })
  const byId = useMemo(() => new Map((runs.data ?? []).map((r) => [r.id, r])), [runs.data])
  const rows = useMemo(() => (runs.data ?? []).map(toGridRow), [runs.data])

  let body: React.ReactNode
  if (runs.isPending) {
    body = (
      <ReportMessage>
        <Skeleton className='h-64 w-full' />
      </ReportMessage>
    )
  } else if (runs.isError) {
    body = (
      <ReportMessage>
        <EmptyState
          className='py-8'
          icon={CircleAlert}
          title='The runs could not be read'
          description={runs.error.message}
        />
      </ReportMessage>
    )
  } else if (rows.length === 0) {
    body = (
      <ReportMessage>
        <EmptyState
          className='py-8'
          icon={History}
          title='No plan runs yet'
          description='Each run dates when every part needs ordering; the history lands here.'
          button={
            can(PermissionKey.mrpManage) ? (
              <MrpRunNowButton variant='outline' className='' />
            ) : undefined
          }
        />
      </ReportMessage>
    )
  } else {
    const count = rows.length
    body = (
      <ReportGrid
        reportKey='mrp-runs'
        columns={[]}
        textColumns={TEXT_COLUMNS}
        rows={rows}
        currency='USD'
        labelHeading='As of'
        defaultLabelWidth={220}
        rowIcon={null}
        // Only a completed run has a plan to read.
        canRowDrill={(row) => byId.get(row.id)?.status === 'completed'}
        // The run every other page reads: the pinned one, else the latest.
        isRowActive={(row) => (runId ? row.id === runId : !!byId.get(row.id)?.isLatest)}
        onRowClick={(row) => (byId.get(row.id)?.isLatest ? clear() : pin(row.id))}
        footer={
          <p className='text-muted-foreground text-xs'>
            {count === RUN_LIMIT
              ? `The latest ${count} runs`
              : `${count} ${count === 1 ? 'run' : 'runs'}`}
          </p>
        }
      />
    )
  }

  return <ReportPageLayout>{body}</ReportPageLayout>
}
