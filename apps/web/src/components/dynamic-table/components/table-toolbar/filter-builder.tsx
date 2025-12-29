// apps/web/src/components/dynamic-table/components/table-toolbar/filter-builder.tsx

'use client'

import { useCallback } from 'react'
import { Filter, Plus, X } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Badge } from '@auxx/ui/components/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Calendar } from '@auxx/ui/components/calendar'
import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { useFilterBuilder } from '../../hooks/use-filter-builder'
import type { ExtendedColumnDef, TableFilter } from '../../types'
import { Label } from '@auxx/ui/components/label'
import { Tooltip } from '~/components/global/tooltip'

interface FilterBuilderProps<TData> {
  columns: ExtendedColumnDef<TData>[]
  filters: TableFilter[]
  onFiltersChange: (filters: TableFilter[]) => void
}

/**
 * Filter builder component for creating dynamic filters
 */
export function FilterBuilder<TData>({
  columns,
  filters,
  onFiltersChange,
}: FilterBuilderProps<TData>) {
  const {
    isOpen,
    setIsOpen,
    localFilters,
    filterableColumns,
    hasFilters,
    canAddMore,
    addFilter,
    updateFilter,
    removeFilter,
    applyFilters,
    clearFilters,
    handleCancel,
    getOperatorsForColumn,
    getColumnInfo,
  } = useFilterBuilder({ columns, filters, onFiltersChange })

  // Render value input based on column type
  const renderValueInput = useCallback(
    (filter: TableFilter, index: number) => {
      const { columnType } = getColumnInfo(filter.columnId)
      const operators = getOperatorsForColumn(filter.columnId)
      const operator = operators.find((op) => op.value === filter.operator)

      // Don't render input if operator doesn't require a value
      if (operator && !operator.requiresValue) {
        return null
      }

      switch (columnType) {
        case 'boolean':
          return (
            <div className="flex items-center space-x-2">
              <Checkbox
                checked={filter.value === true}
                onCheckedChange={(checked) => updateFilter(index, 'value', checked)}
              />
              <Label>True</Label>
            </div>
          )

        case 'date':
          return (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !filter.value && 'text-muted-foreground'
                  )}>
                  <CalendarIcon />
                  {filter.value ? format(new Date(filter.value), 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filter.value ? new Date(filter.value) : undefined}
                  onSelect={(date) => updateFilter(index, 'value', date?.toISOString())}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          )

        case 'number':
          return (
            <Input
              type="number"
              value={filter.value || ''}
              onChange={(e) => updateFilter(index, 'value', e.target.value)}
              placeholder="Enter value"
              className="flex-1 h-7"
            />
          )

        default:
          return (
            <Input
              value={filter.value || ''}
              onChange={(e) => updateFilter(index, 'value', e.target.value)}
              placeholder="Enter value"
              className="flex-1 h-7"
            />
          )
      }
    },
    [getColumnInfo, getOperatorsForColumn, updateFilter]
  )

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div>
          <Tooltip content="Filter rows">
            <Button variant="ghost" size="sm">
              <Filter className="h-3 w-3" />
              <span className="hidden @lg/controls:block">Filter</span>
              {hasFilters && (
                <Badge variant="secondary" className="ml-1 h-4 px-1">
                  {filters.length}
                </Badge>
              )}
            </Button>
          </Tooltip>
        </div>
      </PopoverTrigger>

      <PopoverContent className="w-[520px] p-2" align="start">
        <div className="space-y-4">
          {/* <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Filters</h4>
            {localFilters.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 text-xs">
                Clear all
              </Button>
            )}
          </div> */}

          <div className="space-y-2">
            {localFilters.map((filter, index) => (
              <div key={filter.id} className="flex items-center gap-2">
                {/* Column selector */}
                <Select
                  value={filter.columnId}
                  onValueChange={(value) => updateFilter(index, 'columnId', value)}>
                  <SelectTrigger className="w-[150px] h-7">
                    <SelectValue placeholder="Select column" />
                  </SelectTrigger>
                  <SelectContent>
                    {filterableColumns.map((col) => {
                      const { header } = getColumnInfo(col.accessorKey)
                      return (
                        <SelectItem key={String(col.accessorKey)} value={String(col.accessorKey)}>
                          {header}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>

                {/* Operator selector */}
                <Select
                  value={filter.operator}
                  onValueChange={(value) => updateFilter(index, 'operator', value)}>
                  <SelectTrigger className="w-[140px] h-7">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getOperatorsForColumn(filter.columnId).map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Value input */}
                {renderValueInput(filter, index)}

                {/* Remove button - only show if there's more than one filter */}
                {localFilters.length > 1 && (
                  <Button
                    variant="destructive-hover"
                    size="icon-sm"
                    onClick={() => removeFilter(index)}>
                    <X />
                  </Button>
                )}

                {/* Spacer when remove button is hidden to maintain layout */}
                {localFilters.length === 1 && <div className="h-8 w-8" />}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={addFilter} disabled={!canAddMore}>
              <Plus />
              Add filter
            </Button>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={applyFilters} variant="info">
                Apply filters
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
