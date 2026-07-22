// apps/web/src/components/tasks/ui/task-snooze-button.tsx

'use client'

import type { TaskWithRelations } from '@auxx/lib/tasks'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { addDays } from 'date-fns'
import { AlarmClock } from 'lucide-react'
import { useTaskMutations } from '../hooks/use-task-mutations'
import { formatTaskDeadlineDisplay } from '../utils/group-tasks-by-period'

/** Snooze duration presets offered by the dropdown (build plan Step 7). */
const SNOOZE_PRESETS = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
] as const

/**
 * Snooze control for `TaskForm`'s footer picker cluster (edit mode only — a task must exist
 * to snooze). Excludes the task from default open lists until the chosen date (build plan
 * decision 10) via `api.task.update({ snoozedUntil })`.
 */
export function TaskSnoozeButton({ task }: { task: TaskWithRelations }) {
  const { updateTask } = useTaskMutations()

  const snoozedUntil = task.snoozedUntil ? new Date(task.snoozedUntil) : null
  const isSnoozed = !!snoozedUntil && snoozedUntil.getTime() > Date.now()

  const setSnooze = (date: Date | null) => {
    updateTask.mutate({ id: task.id, snoozedUntil: date ? date.toISOString() : null })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='sm' disabled={updateTask.isPending}>
          <AlarmClock />
          {isSnoozed ? `Snoozed until ${formatTaskDeadlineDisplay(snoozedUntil)}` : 'Snooze'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {SNOOZE_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.label}
            onSelect={() => setSnooze(addDays(new Date(), preset.days))}>
            {preset.label}
          </DropdownMenuItem>
        ))}
        {isSnoozed && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSnooze(null)}>Unsnooze</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
