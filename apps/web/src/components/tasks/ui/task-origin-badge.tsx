// apps/web/src/components/tasks/ui/task-origin-badge.tsx

'use client'

import type { TaskSource, TaskWithRelations } from '@auxx/lib/tasks'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { Zap } from 'lucide-react'

/** Display label for each non-manual `TaskSource`. Manual tasks render no badge. */
const ORIGIN_LABELS: Partial<Record<TaskSource, string>> = {
  rule: 'Rule',
  ai: 'AI',
  kopilot: 'Kopilot',
}

/**
 * Inline provenance badge for non-manually-created tasks (Rule / AI / Kopilot). Renders
 * nothing for `source: 'manual'` — joins the task row's/form's existing inline badge flow
 * (`h-4 w-px bg-border` dividers between groups).
 */
export function TaskOriginBadge({
  task,
  className,
}: {
  task: Pick<TaskWithRelations, 'source'>
  className?: string
}) {
  const label = ORIGIN_LABELS[task.source]
  if (!label) return null
  return (
    <Badge variant='secondary' size='sm' className={cn('align-middle', className)}>
      <Zap />
      {label}
    </Badge>
  )
}

/** Fields `isAutoCompletedTask`/`TaskAutoCompletedTag` need — a subset of `TaskWithRelations`. */
type AutoCompleteFields = Pick<
  TaskWithRelations,
  'autoCompleteOn' | 'completedAt' | 'completedById'
>

/**
 * Derived auto-completed check (build plan decision 3) — there is no dedicated column.
 * Reopening a task clears `completedAt`/`completedById` but leaves `autoCompleteOn` untouched,
 * so a later manual complete (which sets `completedById`) renders as a normal completion, not
 * "Auto (contact replied)".
 */
export function isAutoCompletedTask(task: AutoCompleteFields): boolean {
  return task.autoCompleteOn != null && task.completedAt != null && task.completedById == null
}

/**
 * The "Auto (contact replied)" tag for a derived auto-completed task — shared by the task
 * row and `TaskForm`. Renders nothing when the task isn't (derived) auto-completed.
 */
export function TaskAutoCompletedTag({
  task,
  className,
}: {
  task: AutoCompleteFields
  className?: string
}) {
  if (!isAutoCompletedTask(task)) return null
  return (
    <Badge variant='secondary' size='sm' className={cn('align-middle', className)}>
      <Zap />
      Auto (contact replied)
    </Badge>
  )
}
