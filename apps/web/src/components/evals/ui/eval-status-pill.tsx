// apps/web/src/components/evals/ui/eval-status-pill.tsx
'use client'

import type { EvalRunStatus } from '@auxx/types/evals'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'

/**
 * The single source of truth mapping an {@link EvalRunStatus} (plus the
 * runs-never state) to a dot color + label. Both eval surfaces — agent
 * Simulations and workflow Tests — import this so the palette stays in lockstep.
 *
 * `failed` (an assertion failed) and `error` (execution/grading could not
 * complete) are deliberately distinct hues; the run-detail copy leans on that
 * distinction. See plans/evals/ui-plan.md §"Status color mapping".
 */

/** `null` is the "never run" state — a hollow dot, no run yet. */
export type EvalPillStatus = EvalRunStatus | null

interface StatusVisual {
  label: string
  /** Tailwind classes for the leading status dot. */
  dot: string
  /** Tailwind text color for the label. */
  text: string
}

const STATUS_VISUALS: Record<EvalRunStatus, StatusVisual> = {
  queued: { label: 'Queued', dot: 'bg-slate-400', text: 'text-muted-foreground' },
  running: { label: 'Running', dot: 'bg-blue-500 animate-pulse', text: 'text-blue-600' },
  passed: { label: 'Passed', dot: 'bg-green-500', text: 'text-green-600' },
  failed: { label: 'Failed', dot: 'bg-red-500', text: 'text-red-600' },
  error: { label: 'Error', dot: 'bg-amber-500', text: 'text-amber-600' },
  cancelled: { label: 'Cancelled', dot: 'bg-slate-400', text: 'text-muted-foreground' },
  timed_out: { label: 'Timed out', dot: 'bg-orange-500', text: 'text-orange-600' },
}

const NEVER_RUN: StatusVisual = {
  label: 'Not run',
  dot: 'border border-muted-foreground/40 bg-transparent',
  text: 'text-muted-foreground',
}

/** Resolve the visual for a status (or the never-run state). Exported for callers needing raw colors. */
export function evalStatusVisual(status: EvalPillStatus): StatusVisual {
  return status == null ? NEVER_RUN : STATUS_VISUALS[status]
}

interface EvalStatusDotProps {
  status: EvalPillStatus
  className?: string
}

/** Just the colored dot — for tight rows where the label lives elsewhere. */
export function EvalStatusDot({ status, className }: EvalStatusDotProps) {
  return (
    <span
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        evalStatusVisual(status).dot,
        className
      )}
      aria-hidden
    />
  )
}

interface EvalStatusPillProps {
  status: EvalPillStatus
  /** Override the default label (e.g. a suite "Running… 40%"). */
  label?: string
  className?: string
}

/** Dot + colored label. The canonical run-status chip across both eval surfaces. */
export function EvalStatusPill({ status, label, className }: EvalStatusPillProps) {
  const visual = evalStatusVisual(status)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium',
        visual.text,
        className
      )}>
      <EvalStatusDot status={status} />
      {label ?? visual.label}
    </span>
  )
}

interface EvalDraftBadgeProps {
  /** The compiler `contentHash` of the draft the run tested — tooltip detail. */
  contentHash?: string | null
  className?: string
}

/**
 * Compact "Draft" badge for `runMode: 'draft'` runs/suites (phase 5D.4). A
 * draft run never owns a case's primary status — this badge marks the
 * secondary, draft-tested verdict wherever it appears.
 */
export function EvalDraftBadge({ contentHash, className }: EvalDraftBadgeProps) {
  const badge = (
    <span
      className={cn(
        'inline-flex items-center rounded border border-violet-300 bg-violet-50 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-violet-700',
        className
      )}>
      Draft
    </span>
  )
  if (!contentHash) return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side='top'>
        Tested draft state <span className='font-mono'>{contentHash.slice(0, 8)}</span>
      </TooltipContent>
    </Tooltip>
  )
}
