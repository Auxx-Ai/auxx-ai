// apps/web/src/components/dynamic-table/components/table-toolbar/table-filter-builder.tsx

'use client'

import React, { useMemo, useCallback, useState, useRef } from 'react'
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
  /** Whether a view is currently selected (filters require a view to persist) */
  hasActiveView?: boolean
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
  hasActiveView = true,
}: TableFilterBuilderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const isDisabled = disabled || !hasActiveView

  // ═══════════════════════════════════════════════════════════════════════════
  // BUFFERED STATE PATTERN
  // Keep local draft while editing, only commit when popover closes
  // ═══════════════════════════════════════════════════════════════════════════
  const [draftFilters, setDraftFilters] = useState<ConditionGroup[]>([])
  const isDraftInitialized = useRef(false)

  /** Handle popover open/close - sync draft state */
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        // Opening: copy current filters to draft
        setDraftFilters(filters)
        isDraftInitialized.current = true
      } else if (isDraftInitialized.current) {
        // Closing: commit draft to parent (triggers save)
        onFiltersChange(draftFilters)
        isDraftInitialized.current = false
      }
      setIsOpen(open)
    },
    [filters, draftFilters, onFiltersChange]
  )

  /** Update draft (no save until close) */
  const handleDraftChange = useCallback((groups: ConditionGroup[]) => {
    setDraftFilters(groups)
  }, [])

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

  // Use draft when popover is open, otherwise show committed filters
  const displayFilters = isOpen ? draftFilters : filters
  const totalConditions = displayFilters.reduce((sum, g) => sum + g.conditions.length, 0)
  const hasFilters = totalConditions > 0

  /** Clear all filters and close popover */
  const handleClearAll = useCallback(() => {
    setDraftFilters([])
    onFiltersChange([])
    isDraftInitialized.current = false
    setIsOpen(false)
  }, [onFiltersChange])

  // When no view is selected, show disabled button with tooltip
  if (!hasActiveView) {
    return (
      <Tooltip content="Select or create a view to use filters">
        <div>
          <Button variant="ghost" size="sm" disabled>
            <Filter />
            <span className="hidden @lg/controls:block">Filter</span>
          </Button>
        </div>
      </Tooltip>
    )
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <div>
          <Tooltip content="Filter rows">
            <Button variant="ghost" size="sm" disabled={isDisabled}>
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

      <PopoverContent
        className="w-[400px] max-h-[500px] overflow-auto px-1 pt-1 pb-2"
        align="start">
        <div className="space-y-2 [&_[data-field=add-group]]:ms-1 [&_[data-field=group-condition]:last-child_[data-field=group-divider]]:hidden">
          <ConditionProvider
            conditions={EMPTY_CONDITIONS}
            groups={draftFilters}
            config={config}
            readOnly={isDisabled}
            onConditionsChange={() => {}}
            onGroupsChange={handleDraftChange}
            getAvailableFields={() => fieldDefinitions}
            getFieldDefinition={(id) => fieldDefinitions.find((f) => f.id === id)}>
            <ConditionContainer emptyStateText="Add a filter to start" showAddButton showGrouping />
          </ConditionProvider>
        </div>
      </PopoverContent>
    </Popover>
  )
}
