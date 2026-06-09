// apps/web/src/components/evals/ui/eval-case-row.tsx
'use client'

import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { formatRelativeTime } from '@auxx/utils'
import { ChevronRight, Cog, FlaskConical, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import { EvalStatusDot, EvalStatusPill, evalStatusVisual } from './eval-status-pill'

/** One enriched case from `eval.list` (carries its latest-run summary). */
export type EvalCaseListItem = RouterOutputs['eval']['list'][number]

interface EvalCaseRowProps {
  item: EvalCaseListItem
  /** 0-based indent — procedure-scoped cases sit one level under their group. */
  depth?: number
  /** Cog → opens the case editor drawer. */
  onEdit: () => void
  onRun: () => void
  onDelete: () => void
  /** Drill into a single run's detail view. */
  onOpenRun: (runId: string) => void
  isRunning?: boolean
  isDeleting?: boolean
}

/**
 * A saved simulation case in the suite list. An expandable `TreeRow`: the row
 * shows the latest verdict + when it ran; expanding reveals the run history
 * (verdict + time per run), and clicking a run drills to its detail view. The
 * Cog opens the editor; Run / Delete hover-reveal alongside. See
 * plans/evals/ui-plan.md §"Level 1 — suite list".
 */
export function EvalCaseRow({
  item,
  depth = 0,
  onEdit,
  onRun,
  onDelete,
  onOpenRun,
  isRunning,
  isDeleting,
}: EvalCaseRowProps) {
  const [isOpen, setIsOpen] = useState(false)
  const runsQuery = api.eval.listRuns.useQuery({ caseId: item.id }, { enabled: isOpen })
  const lastRun = item.latestRun

  return (
    <TreeRow
      icon={<FlaskConical className='size-4 text-muted-foreground' />}
      title={item.name}
      depth={depth}
      rowClassName='hover:bg-primary-100'
      expandable
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((o) => !o)}
      secondary={
        <span className='flex items-center gap-1.5'>
          <EvalStatusPill status={lastRun?.status ?? null} />
          {lastRun ? (
            <span className='text-xs text-muted-foreground'>
              {formatRelativeTime(lastRun.at, true)}
            </span>
          ) : null}
        </span>
      }
      actions={
        <div className='flex items-center gap-0'>
          <TreeRowButton tooltipText='Edit' onClick={onEdit} aria-label='Edit simulation'>
            <Cog />
          </TreeRowButton>
          <TreeRowButton
            tooltipText='Run'
            onClick={onRun}
            disabled={isRunning}
            aria-label='Run simulation'>
            <Play />
          </TreeRowButton>
          <TreeRowButton
            variant='destructive'
            tooltipText='Delete'
            onClick={onDelete}
            disabled={isDeleting}
            aria-label='Delete simulation'>
            <Trash2 />
          </TreeRowButton>
        </div>
      }>
      {runsQuery.isLoading ? (
        <TreeRow
          depth={depth + 1}
          title={<span className='text-xs text-muted-foreground'>Loading runs…</span>}
        />
      ) : runsQuery.data?.runs.length ? (
        runsQuery.data.runs.map((run) => (
          <TreeRow
            key={run.id}
            depth={depth + 1}
            rowClassName='hover:bg-primary-100'
            icon={<EvalStatusDot status={run.status} />}
            title={evalStatusVisual(run.status).label}
            secondary={
              <span className='text-xs text-muted-foreground'>
                {formatRelativeTime(run.createdAt, true)}
              </span>
            }
            onTitleClick={() => onOpenRun(run.id)}
            actions={
              <TreeRowButton
                tooltipText='View run'
                onClick={() => onOpenRun(run.id)}
                aria-label='View run detail'>
                <ChevronRight />
              </TreeRowButton>
            }
          />
        ))
      ) : (
        <TreeRow
          depth={depth + 1}
          title={<span className='text-xs text-muted-foreground'>No runs yet.</span>}
        />
      )}
    </TreeRow>
  )
}
