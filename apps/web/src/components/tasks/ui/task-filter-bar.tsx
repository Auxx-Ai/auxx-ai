// apps/web/src/components/tasks/ui/task-filter-bar.tsx

'use client'

import { useMemo, useCallback, useState, useRef } from 'react'
import { Filter, X } from 'lucide-react'
import { Button, buttonVariants } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  ConditionProvider,
  ConditionContainer,
  type ConditionSystemConfig,
  type Condition,
} from '~/components/conditions'
import { TASK_FILTER_FIELDS } from '@auxx/lib/tasks/client'
import { TaskSortSelect } from './task-sort-select'
import type { TaskSortConfig } from '@auxx/lib/tasks/client'

/**
 * Props for TaskFilterBar component
 */
interface TaskFilterBarProps {
  /** Current filter conditions */
  filters: Condition[]
  /** Callback when filters change */
  onFiltersChange: (conditions: Condition[]) => void
  /** Current sort configuration */
  sort: TaskSortConfig
  /** Callback when sort changes */
  onSortChange: (sort: TaskSortConfig) => void
  /** Whether to include completed tasks */
  includeCompleted: boolean
  /** Callback when includeCompleted changes */
  onIncludeCompletedChange: (value: boolean) => void
  /** Whether the filter bar is disabled */
  disabled?: boolean
}

/**
 * TaskFilterBar renders the filter popover and sort select for the task list.
 * Uses simplified condition system config (no grouping, nesting, or reordering).
 */
export function TaskFilterBar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  includeCompleted,
  onIncludeCompletedChange,
  disabled = false,
}: TaskFilterBarProps) {
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [draftFilters, setDraftFilters] = useState<Condition[]>([])
  const isDraftInitialized = useRef(false)

  /** Handle popover open/close - sync draft state */
  const handleFilterOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        // Opening: copy current filters to draft
        setDraftFilters(filters)
        isDraftInitialized.current = true
      } else if (isDraftInitialized.current) {
        // Closing: commit draft to parent
        onFiltersChange(draftFilters)
        isDraftInitialized.current = false
      }
      setIsFilterOpen(open)
    },
    [filters, draftFilters, onFiltersChange]
  )

  /** Update draft (no save until close) */
  const handleDraftChange = useCallback((conditions: Condition[]) => {
    setDraftFilters(conditions)
  }, [])

  /** Clear all filters */
  const handleClearAll = useCallback(() => {
    setDraftFilters([])
    onFiltersChange([])
    isDraftInitialized.current = false
    setIsFilterOpen(false)
  }, [onFiltersChange])

  // Convert TASK_FILTER_FIELDS to FieldDefinition format
  const fieldDefinitions = useMemo(
    () =>
      TASK_FILTER_FIELDS.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        fieldType: field.fieldType,
        operators: field.operators,
        description: field.description,
        enumValues: field.enumValues?.map((v) => ({
          label: v.label,
          value: v.dbValue,
        })),
      })),
    []
  )

  // Condition system config - simplified for task filters
  const config: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource',
      fields: fieldDefinitions,

      // Simplified UI - no grouping or nesting
      showGrouping: false,
      allowNesting: false,
      allowReordering: false,

      // Standard settings
      showLogicalOperators: true,
      allowGroupNaming: false,
      allowGroupCollapse: false,
      allowGroupReordering: false,
      showGroupSubtext: false,

      // No variable mode
      allowVarEditor: false,
      allowConstantToggle: false,
    }),
    [fieldDefinitions]
  )

  // Use draft when popover is open, otherwise show committed filters
  const displayFilters = isFilterOpen ? draftFilters : filters
  const filterCount = displayFilters.length
  const hasFilters = filterCount > 0

  return (
    <div className="flex items-center border-b gap-1.5 py-2 px-3 bg-background overflow-x-auto no-scrollbar w-full">
      {/* Filter Popover */}
      <Popover open={isFilterOpen} onOpenChange={handleFilterOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" disabled={disabled}>
            <Filter />
            <span className="hidden sm:inline">Filter</span>
            {hasFilters && (
              <Badge variant="secondary" className="ml-1 h-4 px-1">
                {filterCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[400px] max-h-[400px] overflow-auto p-2" align="start">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Filters</span>
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  className="h-6 px-2 text-xs">
                  <X className="mr-1 size-3" />
                  Clear all
                </Button>
              )}
            </div>

            <ConditionProvider
              conditions={draftFilters}
              groups={[{ id: 'main', conditions: draftFilters, logicalOperator: 'AND' }]}
              config={config}
              readOnly={disabled}
              onConditionsChange={handleDraftChange}
              onGroupsChange={() => {}}
              getAvailableFields={() => fieldDefinitions}
              getFieldDefinition={(id) => fieldDefinitions.find((f) => f.id === id)}>
              <ConditionContainer
                emptyStateText="Add a filter to start"
                showAddButton
                showGrouping={false}
              />
            </ConditionProvider>
          </div>
        </PopoverContent>
      </Popover>

      {/* Sort Select */}
      <TaskSortSelect value={sort} onChange={onSortChange} disabled={disabled} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Show Completed Toggle */}
      <label
        className={buttonVariants({
          variant: 'ghost',
          size: 'sm',
          className: `gap-2 ${disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`,
        })}>
        <span className="text-muted-foreground text-xs">Show completed</span>
        <Switch
          size="sm"
          checked={includeCompleted}
          onCheckedChange={onIncludeCompletedChange}
          disabled={disabled}
        />
      </label>
    </div>
  )
}
