// apps/web/src/components/tasks/ui/task-snooze-button.tsx

'use client'

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
import { formatTaskDeadlineDisplay } from '../utils/group-tasks-by-period'

/** Snooze duration presets offered by the dropdown (build plan Step 7). */
const SNOOZE_PRESETS = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
] as const

/**
 * Snooze control for `TaskForm`'s footer picker cluster (edit mode only — a task must exist
 * to snooze). Controlled like the other footer pickers: the chosen date is buffered in
 * `TaskForm` state and only persisted on save (build plan decision 10).
 */
export function TaskSnoozeButton({
  value,
  onChange,
  disabled,
}: {
  value: Date | null
  onChange: (date: Date | null) => void
  disabled?: boolean
}) {
  const isSnoozed = !!value && value.getTime() > Date.now()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='sm' disabled={disabled}>
          <AlarmClock />
          {isSnoozed ? `Snoozed until ${formatTaskDeadlineDisplay(value)}` : 'Snooze'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {SNOOZE_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.label}
            onSelect={() => onChange(addDays(new Date(), preset.days))}>
            {preset.label}
          </DropdownMenuItem>
        ))}
        {isSnoozed && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(null)}>Unsnooze</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
