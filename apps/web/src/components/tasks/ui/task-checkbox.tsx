// apps/web/src/components/tasks/ui/task-checkbox.tsx

'use client'

import { Checkbox } from '@auxx/ui/components/checkbox'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Props for TaskCheckbox component
 */
interface TaskCheckboxProps {
  /** Whether the task is completed */
  checked: boolean
  /** Callback when checkbox state changes */
  onCheckedChange: (checked: boolean) => void
  /** Whether the checkbox is disabled (e.g., during mutation) */
  disabled?: boolean
}

/**
 * TaskCheckbox renders a styled checkbox for task completion.
 * Uses the same size and styling as EventIcon for visual consistency.
 */
export function TaskCheckbox({ checked, onCheckedChange, disabled }: TaskCheckboxProps) {
  return (
    <div
      className={cn(
        'size-6 border border-black/10 dark:border-white/10',
        'bg-muted rounded-lg flex items-center justify-center',
        'transition-colors overflow-hidden shrink-0',
        checked && 'bg-good-100 text-good-600',
        disabled && 'opacity-50'
      )}>
      <Checkbox
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className='size-4 border-0 bg-transparent'
      />
    </div>
  )
}
