// apps/web/src/app/(protected)/app/workflows/_components/executions/workflow-runs-filter-bar.tsx
'use client'
import type { WorkflowRunStatus } from '@auxx/database/enums'
import { type DateRange, DateRangePicker } from '@auxx/ui/components/date-range-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { addDays, endOfDay, startOfDay } from 'date-fns'
import { useCallback } from 'react'
import type { WorkflowRunsFilter } from './types'

interface WorkflowRunsFilterBarProps {
  filter: WorkflowRunsFilter
  setFilter: (
    filter: WorkflowRunsFilter | ((prev: WorkflowRunsFilter) => WorkflowRunsFilter)
  ) => void
}
/**
 * Status options for workflow runs filter
 */
const statusOptions = [
  { value: 'all', label: 'All Status' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'SUCCEEDED', label: 'Succeeded' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'STOPPED', label: 'Stopped' },
  { value: 'WAITING', label: 'Waiting' },
] as const
/**
 * Custom filter component for workflow runs - used as customFilter in DynamicTable
 */
export function WorkflowRunsFilterBar({ filter, setFilter }: WorkflowRunsFilterBarProps) {
  // Handle status filter change
  const handleStatusChange = useCallback(
    (value: string) => {
      setFilter((prev) => ({ ...prev, status: value as WorkflowRunStatus | 'all' }))
    },
    [setFilter]
  )
  // Handle date range change
  const handleDateChange = useCallback(
    (range: DateRange) => {
      setFilter((prev) => ({ ...prev, startDate: range.from, endDate: range.to }))
    },
    [setFilter]
  )
  return (
    <div className='flex gap-1 items-center'>
      {/* Date Range Picker */}
      <DateRangePicker
        value={{
          from: filter.startDate || startOfDay(addDays(new Date(), -7)),
          to: filter.endDate || endOfDay(new Date()),
        }}
        onChange={handleDateChange}
        showShortLabel
        triggerClassName='sm:w-[200px] '
        triggerVariant='ghost'
      />

      {/* Status Filter */}
      <Select value={filter.status} onValueChange={handleStatusChange}>
        <SelectTrigger
          className='w-[140px]'
          size='sm'
          className='bg-transparent hover:bg-accent hover:text-accent-foreground border-0'>
          <SelectValue placeholder='Status' />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
