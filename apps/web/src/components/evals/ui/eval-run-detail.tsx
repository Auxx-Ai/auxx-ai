// apps/web/src/components/evals/ui/eval-run-detail.tsx
'use client'

import type { EvalRunStatus } from '@auxx/types/evals'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection } from '@auxx/ui/components/section'
import { Spinner } from '@auxx/ui/components/spinner'
import { cn } from '@auxx/ui/lib/utils'
import { formatRelativeTime } from '@auxx/utils'
import { CircleDot, FileJson, History, ListChecks } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'
import { useEvalRunActions, useEvalRunState } from '../stores/use-eval-run-store'
import { EvalAssertionResultRow } from './eval-assertion-result-row'
import { EvalStatusDot, EvalStatusPill } from './eval-status-pill'
import { EvalTraceView } from './eval-trace-view'

/**
 * Level 3 of the Simulations drill: one run's verdict, trace, and snapshot.
 * Status + trace + assertions come live from the run store (SSE), seeded and
 * back-stopped by `eval.getRun`; the immutable runtime snapshot drives the
 * audit "what ran" tab. See plans/evals/ui-plan.md §"Level 3".
 */

const TERMINAL: ReadonlySet<EvalRunStatus> = new Set<EvalRunStatus>([
  'passed',
  'failed',
  'error',
  'cancelled',
  'timed_out',
])

type AlertVariant = 'good' | 'destructive' | 'warning' | 'blue' | 'default'

const BANNER: Record<EvalRunStatus, { variant: AlertVariant; sentence: string }> = {
  queued: { variant: 'default', sentence: 'Queued — waiting for a worker.' },
  running: { variant: 'blue', sentence: 'Running — streaming the conversation.' },
  passed: { variant: 'good', sentence: 'Passed — every assertion was met.' },
  failed: { variant: 'destructive', sentence: 'Failed — one or more assertions did not pass.' },
  error: {
    variant: 'warning',
    sentence: 'Error — execution or grading could not complete.',
  },
  cancelled: { variant: 'default', sentence: 'Cancelled.' },
  timed_out: { variant: 'warning', sentence: 'Timed out before reaching a verdict.' },
}

type Tab = 'verdict' | 'trace' | 'snapshot'

interface EvalRunDetailProps {
  runId: string
  /** Switches the detail to another run from the same case's history. */
  onSelectRun?: (runId: string) => void
}

export function EvalRunDetail({ runId, onSelectRun }: EvalRunDetailProps) {
  const [tab, setTab] = useState<Tab>('verdict')
  const runQuery = api.eval.getRun.useQuery({ runId })
  const live = useEvalRunState(runId)
  const { connect, hydrateFromRun } = useEvalRunActions()

  const row = runQuery.data
  const caseId = row?.caseId ?? null

  // Seed the store from the authoritative row whenever it (re)loads.
  useEffect(() => {
    if (!row) return
    hydrateFromRun(runId, {
      status: row.status,
      trace: (row.trace ?? []) as never,
      assertionResults: (row.assertionResults ?? []) as never,
    })
  }, [row, runId, hydrateFromRun])

  // Stream while the run is non-terminal.
  useEffect(() => {
    if (row && !TERMINAL.has(row.status)) connect(runId)
  }, [row, runId, connect])

  // SSE dropped mid-run → fall back to the durable row (does not change status itself).
  useEffect(() => {
    if (live.connectionStatus === 'error') void runQuery.refetch()
  }, [live.connectionStatus, runQuery])

  if (runQuery.isLoading) {
    return (
      <div className='flex h-40 items-center justify-center'>
        <Spinner className='size-5 text-muted-foreground' />
      </div>
    )
  }
  if (!row) {
    return (
      <EmptySection
        icon={<CircleDot className='size-4' />}
        title='Run not found'
        description='This run may have been removed.'
      />
    )
  }

  const status = live.status ?? row.status
  const isLive = !TERMINAL.has(status)
  const banner = BANNER[status]
  const assertions = live.assertionResults.length ? live.assertionResults : []

  return (
    <div className='space-y-3 p-3'>
      {/* Verdict banner + run-history switcher */}
      <Alert variant={banner.variant} className='flex items-start justify-between gap-2'>
        <AlertDescription className='flex items-center gap-2'>
          <EvalStatusPill status={status} />
          <span>{row.error ? `${banner.sentence} ${row.error}` : banner.sentence}</span>
        </AlertDescription>
        {caseId ? (
          <RunHistoryPopover caseId={caseId} activeRunId={runId} onSelectRun={onSelectRun} />
        ) : null}
      </Alert>

      <RadioTab
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        size='sm'
        radioGroupClassName='grid w-full grid-cols-3'
        className='h-8 w-full'>
        <RadioTabItem value='verdict' size='sm' className='gap-1'>
          <ListChecks className='size-3.5!' />
          Verdict
        </RadioTabItem>
        <RadioTabItem value='trace' size='sm' className='gap-1'>
          <History className='size-3.5!' />
          Trace
        </RadioTabItem>
        <RadioTabItem value='snapshot' size='sm' className='gap-1'>
          <FileJson className='size-3.5!' />
          Snapshot
        </RadioTabItem>
      </RadioTab>

      {tab === 'verdict' ? (
        assertions.length ? (
          <div className='space-y-0.5'>
            {assertions.map((r) => (
              <EvalAssertionResultRow key={r.assertionId} result={r} />
            ))}
          </div>
        ) : (
          <EmptySection
            icon={<ListChecks className='size-4' />}
            title={isLive ? 'Grading pending' : 'No assertion results'}
            description={
              isLive ? 'Assertions are graded once the conversation completes.' : undefined
            }
            loading={isLive}
          />
        )
      ) : null}

      {tab === 'trace' ? <EvalTraceView trace={live.trace} isLive={isLive} /> : null}

      {tab === 'snapshot' ? <SnapshotTab runtimeSnapshot={row.runtimeSnapshot} /> : null}
    </div>
  )
}

// ── Snapshot tab ─────────────────────────────────────────────────────────────

interface ProviderModel {
  provider?: string
  model?: string
}
interface RuntimeSnapshotView {
  codeRevision?: string
  scope?: string
  agent?: { model?: ProviderModel; utilityModel?: ProviderModel }
  personaModel?: ProviderModel
  graderModel?: ProviderModel
  mockPolicy?: string
  limits?: { maxCustomerTurns?: number; maxReinvokes?: number; maxIterations?: number }
  time?: { frozenAt?: string | null }
}

function modelLabel(m?: ProviderModel): string {
  if (!m?.model) return '—'
  return m.provider ? `${m.provider} · ${m.model}` : m.model
}

function SnapshotTab({ runtimeSnapshot }: { runtimeSnapshot: Record<string, unknown> }) {
  const s = runtimeSnapshot as RuntimeSnapshotView
  const rows: { label: string; value: string }[] = [
    { label: 'Code revision', value: s.codeRevision ?? '—' },
    { label: 'Scope', value: s.scope ?? '—' },
    { label: 'Agent model', value: modelLabel(s.agent?.model) },
    { label: 'Utility model', value: modelLabel(s.agent?.utilityModel) },
    { label: 'Customer (persona)', value: modelLabel(s.personaModel) },
    { label: 'Grader', value: modelLabel(s.graderModel) },
    {
      label: 'Execution',
      value: s.mockPolicy === 'passthrough_readonly' ? 'Passthrough read-only' : 'Offline (mocked)',
    },
    { label: 'Max customer turns', value: String(s.limits?.maxCustomerTurns ?? '—') },
    { label: 'Frozen time', value: s.time?.frozenAt ?? 'Live clock' },
  ]
  return (
    <dl className='divide-y rounded-lg border text-xs'>
      {rows.map((r) => (
        <div key={r.label} className='flex items-center justify-between gap-3 px-3 py-1.5'>
          <dt className='text-muted-foreground'>{r.label}</dt>
          <dd className='truncate font-mono'>{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ── Run-history popover ──────────────────────────────────────────────────────

interface RunHistoryPopoverProps {
  caseId: string
  activeRunId: string
  onSelectRun?: (runId: string) => void
}

function RunHistoryPopover({ caseId, activeRunId, onSelectRun }: RunHistoryPopoverProps) {
  const [open, setOpen] = useState(false)
  const runsQuery = api.eval.listRuns.useQuery({ caseId }, { enabled: open })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='xs'>
          <History />
          Runs
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='max-h-[400px] w-72 overflow-y-auto p-2'>
        <div className='mb-1 px-1 text-xs font-medium'>Run history</div>
        {runsQuery.isLoading ? (
          <div className='flex justify-center py-4'>
            <Spinner className='size-4 text-muted-foreground' />
          </div>
        ) : runsQuery.data?.runs.length ? (
          <ScrollArea className='max-h-[340px]'>
            {runsQuery.data.runs.map((run) => (
              <button
                type='button'
                key={run.id}
                onClick={() => {
                  onSelectRun?.(run.id)
                  setOpen(false)
                }}
                className={cn(
                  'mb-1 flex w-full items-center gap-2 rounded-lg border-[0.5px] border-border bg-secondary/30 px-2.5 py-1.5 text-left shadow-xs transition-all last-of-type:mb-0',
                  'hover:bg-secondary/50 hover:ring-1 hover:ring-blue-500',
                  run.id === activeRunId && 'bg-secondary/50 ring-1 ring-blue-500'
                )}>
                <EvalStatusDot status={run.status} />
                <span className='flex-1 text-xs capitalize'>{run.status.replace(/_/g, ' ')}</span>
                <span className='text-[10px] text-muted-foreground'>
                  {formatRelativeTime(run.createdAt, true)}
                </span>
              </button>
            ))}
          </ScrollArea>
        ) : (
          <div className='px-1 py-2 text-xs text-muted-foreground'>No runs yet.</div>
        )}
      </PopoverContent>
    </Popover>
  )
}
