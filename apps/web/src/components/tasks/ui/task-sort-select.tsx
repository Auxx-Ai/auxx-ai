// apps/web/src/components/tasks/ui/task-sort-select.tsx

'use client'

import { TASK_SORT_OPTIONS, type TaskSortConfig, type TaskSortField } from '@auxx/lib/tasks/client'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { ArrowDown, ArrowUp, Calendar, CheckCircle, Clock, Flag, Type, User } from 'lucide-react'
import { useCallback } from 'react'

/** Icon mapping for sort fields */
const SORT_ICONS: Record<TaskSortField, typeof Calendar> = {
  deadline: Calendar,
  createdAt: Clock,
  assignee: User,
  priority: Flag,
  title: Type,
  completedAt: CheckCircle,
}

/**
 * Props for TaskSortSelect component
 */
interface TaskSortSelectProps {
  value: TaskSortConfig
  onChange: (config: TaskSortConfig) => void
  disabled?: boolean
}

/**
 * TaskSortSelect renders a dropdown for selecting sort field and direction.
 */
export function TaskSortSelect({ value, onChange, disabled = false }: TaskSortSelectProps) {
  /** Handle sort field change */
  const handleFieldChange = useCallback(
    (field: string) => {
      const option = TASK_SORT_OPTIONS.find((o) => o.field === field)
      if (option) {
        onChange({
          field: option.field,
          direction: option.defaultDirection,
        })
      }
    },
    [onChange]
  )

  /** Toggle sort direction */
  const handleDirectionToggle = useCallback(() => {
    onChange({
      ...value,
      direction: value.direction === 'asc' ? 'desc' : 'asc',
    })
  }, [value, onChange])

  return (
    <div className='flex items-center'>
      <Select value={value.field} onValueChange={handleFieldChange} disabled={disabled}>
        <SelectTrigger className='w-[140px]' size='sm' variant='outline'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TASK_SORT_OPTIONS.map((option) => {
            const OptionIcon = SORT_ICONS[option.field]
            return (
              <SelectItem key={option.field} value={option.field}>
                <div className='flex items-center gap-2'>
                  <OptionIcon className='size-4 text-muted-foreground' />
                  {option.label}
                </div>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>

      <Button
        variant='ghost'
        size='icon-sm'
        onClick={handleDirectionToggle}
        disabled={disabled}
        className='h-8 w-8'>
        {value.direction === 'asc' ? (
          <ArrowUp className='size-4' />
        ) : (
          <ArrowDown className='size-4' />
        )}
      </Button>
    </div>
  )
}
