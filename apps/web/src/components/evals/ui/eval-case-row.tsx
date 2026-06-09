// apps/web/src/components/evals/ui/eval-case-row.tsx
'use client'

import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { formatRelativeTime } from '@auxx/utils'
import { FlaskConical, Play, Trash2 } from 'lucide-react'
import type { RouterOutputs } from '~/trpc/react'
import { EvalStatusPill } from './eval-status-pill'

/** One enriched case from `eval.list` (carries its latest-run summary). */
export type EvalCaseListItem = RouterOutputs['eval']['list'][number]

interface EvalCaseRowProps {
  item: EvalCaseListItem
  /** Human label for the case scope ("Whole agent" or the procedure name). */
  scopeLabel: string
  onOpen: () => void
  onRun: () => void
  onDelete: () => void
  isRunning?: boolean
  isDeleting?: boolean
}

/**
 * A saved simulation case in the suite list. A leaf `TreeRow` (no chevron — the
 * drill is the title click); secondary reads "<status> · <scope> · <last run>".
 * Run / Delete hover-reveal in the actions slot. See plans/evals/ui-plan.md
 * §"Level 1 — suite list".
 */
export function EvalCaseRow({
  item,
  scopeLabel,
  onOpen,
  onRun,
  onDelete,
  isRunning,
  isDeleting,
}: EvalCaseRowProps) {
  const lastRun = item.latestRun
  return (
    <TreeRow
      icon={<FlaskConical className='size-4 text-muted-foreground' />}
      title={item.name}
      onTitleClick={onOpen}
      secondary={
        <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
          <EvalStatusPill status={lastRun?.status ?? null} />
          <span aria-hidden>·</span>
          <span className='truncate'>{scopeLabel}</span>
          {lastRun ? (
            <>
              <span aria-hidden>·</span>
              <span>{formatRelativeTime(lastRun.at, true)}</span>
            </>
          ) : null}
        </span>
      }
      actions={
        <>
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
        </>
      }
    />
  )
}
