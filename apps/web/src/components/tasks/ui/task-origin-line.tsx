// apps/web/src/components/tasks/ui/task-origin-line.tsx

'use client'

import { isSignalKind, SIGNAL_KINDS } from '@auxx/lib/signals/client'
import type { TaskWithRelations } from '@auxx/lib/tasks'
import { Zap } from 'lucide-react'
import { api } from '~/trpc/react'
import { formatTaskDeadlineDisplay } from '../utils/group-tasks-by-period'

/**
 * Full provenance line for the task form (edit mode, non-manual tasks only, mounted between
 * the header and the editor by `TaskForm`): which rule created the task — name resolved from
 * the same `api.recordRules.list` query the rules settings UI uses, falling back to "a
 * deleted rule" — plus, when a signal triggered it, the signal context sentence. Silently
 * degrades to rule-name-only when the signal row has been pruned by retention (`signal.byId`
 * returns `null`).
 */
export function TaskOriginLine({ task }: { task: TaskWithRelations }) {
  const { data: rules } = api.recordRules.list.useQuery(undefined, {
    enabled: task.source === 'rule' && !!task.sourceRuleId,
  })
  const { data: signal } = api.signal.byId.useQuery(
    { signalId: task.sourceSignalId ?? '' },
    { enabled: !!task.sourceSignalId }
  )

  if (task.source === 'manual') return null

  let text: string
  if (task.source === 'rule') {
    const rule = task.sourceRuleId ? rules?.find((r) => r.id === task.sourceRuleId) : undefined
    const ruleName = task.sourceRuleId ? (rule?.name ?? 'a deleted rule') : 'a deleted rule'
    text = `Created by rule "${ruleName}"`

    if (signal && isSignalKind(signal.kind)) {
      const kindLabel = SIGNAL_KINDS[signal.kind].label.toLowerCase()
      text += ` after ${kindLabel} on ${formatTaskDeadlineDisplay(new Date(signal.occurredAt))}`
    }
  } else if (task.source === 'ai') {
    text = 'Created by AI'
  } else {
    text = 'Created via Kopilot'
  }

  return (
    <div className='flex items-center gap-1.5 px-4 pt-3 text-xs text-muted-foreground'>
      <Zap className='size-3 shrink-0' />
      <span>{text}</span>
    </div>
  )
}
