// apps/web/src/components/dynamic-table/components/table-toolbar/table-filter-builder.tsx

'use client'

import React, { useMemo, useCallback } from 'react'
import { Filter, X } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  ConditionProvider,
  ConditionContainer,
  type ConditionSystemConfig,
  type Condition,
} from '~/components/conditions'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { getFieldOperators, BaseType } from '@auxx/lib/workflow-engine/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { Tooltip } from '~/components/global/tooltip'

/** Stable empty array to avoid re-renders */
const EMPTY_CONDITIONS: Condition[] = []

interface TableFilterBuilderProps {
  /** Current filter groups */
  filters: ConditionGroup[]
  /** Callback when filters change */
  onFiltersChange: (groups: ConditionGroup[]) => void
  /** Available fields for filtering */
  filterableFields: ResourceField[]
  /** Resource type */
  resourceType: string
  /** Disabled state */
  disabled?: boolean
}

/**
 * Filter builder for dynamic tables.
 * Uses the shared condition UI components.
 *
 * Field conversion pattern matches workflow/nodes/core/find/panel.tsx
 */
export function TableFilterBuilder({
  filters,
  onFiltersChange,
  filterableFields,
  resourceType,
  disabled = false,
}: TableFilterBuilderProps) {
  const [isOpen, setIsOpen] = React.useState(false)

  // Convert ResourceField[] to FieldDefinition[]
  // Pattern from: workflow/nodes/core/find/panel.tsx
  const fieldDefinitions = useMemo(() => {
    return filterableFields.map((field) => ({
      id: field.key,
      label: field.label,
      type: field.type,
      // Use operatorOverrides if defined, otherwise get defaults for field type
      operators: field.operatorOverrides || getFieldOperators(field),
      // Pass enumValues directly - value-input.tsx handles { dbValue, label } → { value, label } conversion
      enumValues: field.enumValues,
      // Add fieldReference for RELATION type fields
      ...(field.type === BaseType.RELATION &&
        field.relationship && {
          fieldReference: `${resourceType}:${field.key}`,
        }),
    }))
  }, [filterableFields, resourceType])

  // Config - no variable features (table filters are always constant values)
  const config: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource',
      fields: fieldDefinitions,
      allowNesting: false,
      allowReordering: true,
      showLogicalOperators: true,
      showGrouping: true,
      allowGroupNaming: false,
      allowGroupCollapse: false,
      allowGroupReordering: true,
      showGroupSubtext: false,
      defaultGroupName: 'Filter',
      allowVarEditor: false,
      allowConstantToggle: false,
    }),
    [fieldDefinitions]
  )

  const totalConditions = filters.reduce((sum, g) => sum + g.conditions.length, 0)
  const hasFilters = totalConditions > 0

  const handleClearAll = useCallback(() => {
    onFiltersChange([])
    setIsOpen(false)
  }, [onFiltersChange])

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div>
          <Tooltip content="Filter rows">
            <Button variant="ghost" size="sm" disabled={disabled}>
              <Filter />
              <span className="hidden @lg/controls:block">Filter</span>
              {hasFilters && (
                <Badge variant="secondary" className="ml-1 h-4 px-1">
                  {totalConditions}
                </Badge>
              )}
            </Button>
          </Tooltip>
        </div>
      </PopoverTrigger>

      <PopoverContent className="w-[600px] max-h-[500px] overflow-auto p-4" align="start">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Filters</h4>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={handleClearAll}>
                <X className="mr-1" />
                Clear all
              </Button>
            )}
          </div>

          <ConditionProvider
            conditions={EMPTY_CONDITIONS}
            groups={filters}
            config={config}
            readOnly={disabled}
            onConditionsChange={() => {}}
            onGroupsChange={onFiltersChange}
            getAvailableFields={() => fieldDefinitions}
            getFieldDefinition={(id) => fieldDefinitions.find((f) => f.id === id)}
          >
            <ConditionContainer
              emptyStateText="Add a filter to start"
              showAddButton
              showGrouping
            />
          </ConditionProvider>
        </div>
      </PopoverContent>
    </Popover>
  )
}
