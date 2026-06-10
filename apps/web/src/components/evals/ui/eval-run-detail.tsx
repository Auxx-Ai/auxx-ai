// apps/web/src/components/evals/ui/eval-run-detail.tsx
'use client'

import type { EvalRunStatus } from '@auxx/types/evals'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { useNavStack } from '@auxx/ui/components/nav-stack'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { Spinner } from '@auxx/ui/components/spinner'
import { toastError } from '@auxx/ui/components/toast'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { cn } from '@auxx/ui/lib/utils'
import { formatRelativeTime } from '@auxx/utils'
import { Check, CircleDot, Copy, FileJson, History, ListChecks, Trash2, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { buildFixSeedMessage } from '../hooks/build-fix-seed'
import { useEvalRunActions, useEvalRunState } from '../stores/use-eval-run-store'
import { EvalAssertionResultRow } from './eval-assertion-result-row'
import { EvalDrillBar } from './eval-drill-bar'
import { EvalDraftBadge, EvalStatusDot, EvalStatusPill } from './eval-status-pill'
import { EvalTraceView } from './eval-trace-view'
import { type TraceMarkdownMeta, traceToMarkdown } from './messages/eval-trace-markdown'

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

/**
 * Bleeds a `Section`'s content past its `p-3` padding so tree rows span full
 * width; the inner `ps-2 pe-4` div re-pads. Mirrors the suite panel.
 */
const SECTION_BLEED = '[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'

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

interface EvalRunDetailProps {
  runId: string
  /** Switches the detail to another run from the same case's history. */
  onSelectRun?: (runId: string) => void
  /** Hands a failing run to the builder chat with a seeded message (5D.1). */
  onFixWithKopilot?: (seed: string) => void
}

export function EvalRunDetail({ runId, onSelectRun, onFixWithKopilot }: EvalRunDetailProps) {
  const runQuery = api.eval.getRun.useQuery({ runId })
  const live = useEvalRunState(runId)
  const { connect, hydrateFromRun } = useEvalRunActions()
  const utils = api.useUtils()
  const { pop } = useNavStack()
  const [confirm, ConfirmDialog] = useConfirm()

  const row = runQuery.data
  const caseId = row?.caseId ?? null

  // Deleting the run pops back to the previous panel (the run no longer exists)
  // and refreshes the case's run list + latest-run pill.
  const deleteRun = api.eval.deleteRun.useMutation({
    onSuccess: () => {
      if (caseId) void utils.eval.listRuns.invalidate({ caseId })
      void utils.eval.list.invalidate()
      pop()
    },
    onError: (err) => toastError({ title: 'Failed to delete run', description: err.message }),
  })

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete run?',
      description: 'This run and its trace will be removed. This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deleteRun.mutate({ runId })
  }

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

  // The back bar carries the run-history switcher on its right; it stays mounted
  // across loading / not-found so navigation never disappears.
  const bar = (
    <>
      <ConfirmDialog />
      <EvalDrillBar
        title='Run detail'
        actions={
          <>
            {caseId ? (
              <RunHistoryPopover caseId={caseId} activeRunId={runId} onSelectRun={onSelectRun} />
            ) : null}
            <Button
              variant='ghost'
              size='icon-xs'
              className='text-muted-foreground hover:text-destructive'
              loading={deleteRun.isPending}
              onClick={handleDelete}
              aria-label='Delete run'>
              <Trash2 />
            </Button>
          </>
        }
      />
    </>
  )

  if (runQuery.isLoading) {
    return (
      <>
        {bar}
        <div className='flex h-40 items-center justify-center'>
          <Spinner className='size-5 text-muted-foreground' />
        </div>
      </>
    )
  }
  if (!row) {
    return (
      <>
        {bar}
        <EmptySection
          icon={<CircleDot className='size-4' />}
          title='Run not found'
          description='This run may have been removed.'
        />
      </>
    )
  }

  const status = live.status ?? row.status
  const isLive = !TERMINAL.has(status)
  const banner = BANNER[status]
  const isDraftRun = row.runMode === 'draft'
  const snapshot = row.runtimeSnapshot as { draftContentHash?: string } | null
  const caseName =
    (row.definitionSnapshot as { case?: { name?: string } } | null)?.case?.name ?? 'Simulation'
  const assertions = live.assertionResults.length ? live.assertionResults : []
  const assertionTally = assertions.reduce(
    (acc, r) => {
      acc[r.status] += 1
      return acc
    },
    { passed: 0, failed: 0, error: 0 }
  )

  return (
    <>
      {bar}
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        {/* Verdict banner */}
        <div className='flex flex-col gap-2 p-3'>
          <Alert variant={banner.variant}>
            <AlertDescription className='flex flex-wrap items-center gap-2 opacity-100'>
              <EvalStatusPill status={status} />
              {isDraftRun && <EvalDraftBadge contentHash={snapshot?.draftContentHash} />}
              <span>{row.error ? `${banner.sentence} ${row.error}` : banner.sentence}</span>
            </AlertDescription>
          </Alert>
          {isDraftRun && (
            <p className='text-[11px] text-muted-foreground'>
              Ran against the draft (not the published version).
            </p>
          )}
          {onFixWithKopilot && (status === 'failed' || status === 'error') && (
            <Button
              variant='outline'
              size='sm'
              className='self-start'
              onClick={() =>
                onFixWithKopilot(
                  buildFixSeedMessage({
                    suiteRunId: row.suiteRunId,
                    runs: [
                      {
                        runId: row.id,
                        caseName,
                        failedAssertions: assertions
                          .filter((a) => a.status !== 'passed')
                          .map((a) => ({ type: a.type, note: a.note })),
                      },
                    ],
                  })
                )
              }>
              <Wrench />
              Fix with Kopilot
            </Button>
          )}
        </div>

        <Section
          title='Verdict'
          icon={<ListChecks className='size-4' />}
          description='Per-assertion pass/fail for this run.'
          className={SECTION_BLEED}
          collapsible>
          <div className='flex flex-col ps-2 pe-4'>
            {assertions.length ? (
              assertions.map((r) => <EvalAssertionResultRow key={r.assertionId} result={r} />)
            ) : (
              <EmptySection
                icon={<ListChecks className='size-4' />}
                title={isLive ? 'Grading pending' : 'No assertion results'}
                description={
                  isLive ? 'Assertions are graded once the conversation completes.' : undefined
                }
                loading={isLive}
              />
            )}
          </div>
        </Section>

        <Section
          title='Trace'
          icon={<History className='size-4' />}
          description='The conversation and tool calls, in order.'
          className={SECTION_BLEED}
          actions={
            <CopyTraceButton
              trace={live.trace}
              meta={{
                status,
                summary: row.error ? `${banner.sentence} ${row.error}` : banner.sentence,
                assertions: assertionTally,
              }}
            />
          }
          collapsible>
          <div className='flex flex-col ps-2 pe-4'>
            <EvalTraceView trace={live.trace} isLive={isLive} />
          </div>
        </Section>

        <Section
          title='Snapshot'
          icon={<FileJson className='size-4' />}
          description='The exact runtime that executed — models, limits, mock policy.'
          className={SECTION_BLEED}
          collapsible
          initialOpen={false}>
          <div className='flex flex-col ps-2 pe-4'>
            <SnapshotTab runtimeSnapshot={row.runtimeSnapshot} />
          </div>
        </Section>
      </ScrollArea>
    </>
  )
}

// ── Copy-trace action ────────────────────────────────────────────────────────

/**
 * Header action for the Trace section — copies the full trace as Markdown
 * (metadata header + conversation + tool args/output/badge + notices). Sits in
 * the section `actions` slot, outside the collapse trigger, so it never toggles
 * the section. Disabled until there are events to copy.
 */
function CopyTraceButton({
  trace,
  meta,
}: {
  trace: React.ComponentProps<typeof EvalTraceView>['trace']
  meta: TraceMarkdownMeta
}) {
  const copy = useCopy({ toastMessage: 'Trace copied as Markdown' })
  return (
    <Button
      variant='ghost'
      size='icon-xs'
      className='text-muted-foreground'
      disabled={trace.length === 0}
      onClick={() => copy.copy(traceToMarkdown(trace, meta))}
      aria-label='Copy trace as Markdown'>
      {copy.copied ? <Check /> : <Copy />}
    </Button>
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
  runMode?: string
  draftContentHash?: string
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
    { label: 'Run mode', value: s.runMode ?? 'pinned' },
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
