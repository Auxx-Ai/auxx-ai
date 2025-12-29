// components/mail-views/MailViewFilterBuilder.tsx
'use client'

import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { PlusCircle, Trash2, ArrowDownUp } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { type MailViewFormValues } from './mail-view-dialog'
import { MailViewFilterCondition } from './mail-view-filter-condition'
import { cn } from '@auxx/ui/lib/utils'
import {
  type MailViewFilter,
  FilterOperator,
  ConditionType,
  type FilterCondition,
  ComparisonOperator,
} from '@auxx/lib/types'

/**
 * Component for building the filter logic for a mail view.
 * Allows adding/removing conditions and groups (one level deep), and setting AND/OR logic.
 */
export function MailViewFilterBuilder() {
  const { watch, setValue, getValues } = useFormContext<MailViewFormValues>()
  // Watch the entire filters object for updates
  const filters = watch('filters') as MailViewFilter
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])

  // Ensure filters and filters.conditions are initialized
  if (!filters || !Array.isArray(filters.conditions)) {
    console.warn(
      'MailViewFilterBuilder: filters or filters.conditions is not initialized or invalid.'
    )
    return (
      <Alert variant="destructive">
        <AlertDescription>Filter data is missing or invalid.</AlertDescription>
      </Alert>
    )
  }

  // Generate a unique ID for new groups (conditions don't strictly need persisted IDs)
  const generateGroupId = () => `group_${Math.random().toString(36).substring(2, 11)}`

  // --- Top Level Actions ---

  const addTopLevelCondition = () => {
    const newCondition: FilterCondition = {
      type: ConditionType.INBOX,
      operator: getDefaultOperatorForType(ConditionType.INBOX),
      value: null,
    }
    const currentConditions = getValues('filters.conditions') || []
    setValue('filters.conditions', [...currentConditions, newCondition], { shouldDirty: true })
  }

  const addGroup = () => {
    const newGroup: MailViewFilter & { id: string } = {
      // Add ID for UI state
      id: generateGroupId(),
      operator: FilterOperator.AND,
      conditions: [],
    }
    const currentConditions = getValues('filters.conditions') || []
    setValue('filters.conditions', [...currentConditions, newGroup], { shouldDirty: true })
    setExpandedGroups((prev) => [...prev, newGroup.id]) // Expand new group
  }

  const removeTopLevelItem = (indexToRemove: number) => {
    const currentConditions = getValues('filters.conditions') || []
    const itemToRemove = currentConditions[indexToRemove]
    const updatedConditions = currentConditions.filter(
      (_: FilterCondition | MailViewFilter, index: number) => index !== indexToRemove
    )
    setValue('filters.conditions', updatedConditions, { shouldDirty: true })

    // Clean up expansion state if a group was removed
    if (itemToRemove && isFilterGroup(itemToRemove) && itemToRemove.id) {
      setExpandedGroups((prev) => prev.filter((id) => id !== itemToRemove.id))
    }
  }

  const updateTopLevelOperator = (value: FilterOperator) => {
    setValue('filters.operator', value, { shouldDirty: true })
  }

  // --- Group Level Actions ---

  const addConditionToGroup = (groupIndex: number) => {
    const groupPath = `filters.conditions[${groupIndex}]`
    const group = getValues(groupPath as any) as MailViewFilter // Get current group data
    if (!group || !Array.isArray(group.conditions)) {
      console.error(`Could not find group at index ${groupIndex} to add condition.`)
      return
    }

    const newCondition: FilterCondition = {
      type: ConditionType.INBOX, // Sensible default
      operator: getDefaultOperatorForType(ConditionType.INBOX),
      value: null,
    }

    const updatedGroupConditions = [...group.conditions, newCondition]
    setValue(`${groupPath}.conditions` as any, updatedGroupConditions, { shouldDirty: true })
  }

  const removeConditionFromGroup = (groupIndex: number, conditionIndex: number) => {
    const groupPath = `filters.conditions[${groupIndex}]`
    const group = getValues(groupPath as any) as MailViewFilter
    if (!group || !Array.isArray(group.conditions)) {
      console.error(`Could not find group at index ${groupIndex} to remove condition.`)
      return
    }
    const updatedGroupConditions = group.conditions.filter(
      (_: FilterCondition | MailViewFilter, idx: number) => idx !== conditionIndex
    )
    setValue(`${groupPath}.conditions` as any, updatedGroupConditions, { shouldDirty: true })
  }

  const updateGroupOperator = (groupIndex: number, value: FilterOperator) => {
    const groupPath = `filters.conditions[${groupIndex}].operator`
    setValue(groupPath as any, value, { shouldDirty: true })
  }

  // --- UI Helpers ---

  const toggleGroupExpansion = (groupId: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    )
  }

  // Type Guard to check if an item is a filter group (with potential UI id)
  const isFilterGroup = (item: any): item is MailViewFilter & { id?: string } => {
    return (
      item &&
      typeof item === 'object' &&
      'conditions' in item &&
      Array.isArray(item.conditions) &&
      'operator' in item && // Also check for operator to be more specific
      Object.values(FilterOperator).includes(item.operator)
    )
  }

  return (
    <div className="space-y-4">
      {/* Top Level Operator */}
      <div className=" flex items-center gap-2">
        <label htmlFor="main-filter-operator" className="text-sm">
          Match
        </label>
        <Select
          value={filters.operator}
          onValueChange={(value) => updateTopLevelOperator(value as FilterOperator)}>
          <SelectTrigger id="main-filter-operator" className="w-[160px]" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FilterOperator.AND}>ALL conditions</SelectItem>
            <SelectItem value={FilterOperator.OR}>ANY condition</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Conditions/Groups List */}
      {!filters.conditions || filters.conditions.length === 0 ? (
        <Alert variant="default" className="border-dashed">
          <AlertCircle />
          <AlertDescription>No filters added yet. Add conditions or groups below.</AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-3">
          {/* Use watched filters.conditions which reflects state updates */}
          {(filters.conditions || []).map((item, index) => {
            // Use index for path/removal, ID for key/expansion if available
            // Cast item to include potential 'id' for groups
            const itemWithId = item as FilterCondition | (MailViewFilter & { id?: string })
            const key =
              itemWithId && 'id' in itemWithId && itemWithId.id ? itemWithId.id : `item-${index}`
            const itemId = itemWithId && 'id' in itemWithId && itemWithId.id ? itemWithId.id : null // Group ID for expansion state

            return (
              // Wrap each item in a Card for visual separation
              <div
                key={key}
                className={cn(
                  'relative',
                  isFilterGroup(itemWithId)
                    ? 'border-blue-500/30 bg-background/60'
                    : 'bg-background/90'
                )}>
                {isFilterGroup(itemWithId) ? ( // Check using the type guard
                  // --- Render Group ---
                  <div className="space-y-3">
                    {/* Group Header: Toggle, Operator Select, Remove Button */}
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex grow items-center gap-2">
                        <Button
                          variant="ghost"
                          type="button"
                          size="sm"
                          className=""
                          onClick={() => itemId && toggleGroupExpansion(itemId)}
                          disabled={!itemId}
                          aria-expanded={itemId ? expandedGroups.includes(itemId) : false}
                          aria-controls={`group-content-${itemId}`}>
                          <ArrowDownUp
                            className={cn(
                              'transition-transform',
                              itemId && expandedGroups.includes(itemId) ? 'rotate-180' : ''
                            )}
                          />
                          Group: Match
                        </Button>
                        <Select
                          value={itemWithId.operator} // Group's operator
                          onValueChange={(value) =>
                            updateGroupOperator(index, value as FilterOperator)
                          }>
                          <SelectTrigger className=" w-[90px]" size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={FilterOperator.AND}>ALL</SelectItem>
                            <SelectItem value={FilterOperator.OR}>ANY</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="text-sm text-muted-foreground">of:</span>
                      </div>
                      <Button
                        variant="ghost"
                        type="button"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeTopLevelItem(index)}>
                        <Trash2 />
                        <span className="sr-only">Remove group</span>
                      </Button>
                    </div>

                    {/* Nested Conditions Area (only if expanded) */}
                    {itemId && expandedGroups.includes(itemId) && (
                      <div
                        id={`group-content-${itemId}`}
                        className="ml-2 space-y-3 border-l-2 border-border py-2 pl-4">
                        {/* Render existing nested conditions */}
                        {itemWithId.conditions.length === 0 ? (
                          <div className="h-7 flex items-center text-sm italic text-muted-foreground">
                            No conditions added to this group yet.
                          </div>
                        ) : (
                          itemWithId.conditions.map((nestedCondition, nestedIndex) => (
                            // Use nested index for key/removal within the group
                            <div
                              key={`nested-${index}-${nestedIndex}`}
                              className="flex items-center justify-between gap-2">
                              <div className="grow">
                                <MailViewFilterCondition
                                  condition={nestedCondition as FilterCondition}
                                  onChange={(updated) => {
                                    const groupPath = `filters.conditions[${index}]`
                                    const group = getValues(groupPath as any) as MailViewFilter
                                    if (!group?.conditions) return
                                    const updatedConditions = [...group.conditions]
                                    updatedConditions[nestedIndex] = updated
                                    setValue(`${groupPath}.conditions` as any, updatedConditions, {
                                      shouldDirty: true,
                                    })
                                  }}
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => removeConditionFromGroup(index, nestedIndex)}>
                                <Trash2 />
                                <span className="sr-only">Remove condition from group</span>
                              </Button>
                            </div>
                          ))
                        )}

                        {/* Button to add condition TO THIS GROUP */}
                        <div className="mt-2 border-t border-dashed pt-2">
                          <Button
                            size="xs"
                            variant="outline"
                            type="button"
                            onClick={() => addConditionToGroup(index)}
                            className="">
                            <PlusCircle /> Add Condition to Group
                          </Button>
                          {/* "Add Group" button is intentionally omitted here for single-level nesting */}
                        </div>
                      </div>
                    )}
                  </div> // End Group div
                ) : (
                  // --- Render Top-Level Condition ---
                  <div className="flex items-center justify-between gap-2">
                    <div className="grow">
                      <MailViewFilterCondition
                        condition={itemWithId as FilterCondition}
                        onChange={(updated) => {
                          const currentConditions = getValues('filters.conditions') || []
                          const updatedConditions = [...currentConditions]
                          updatedConditions[index] = updated
                          setValue('filters.conditions', updatedConditions, { shouldDirty: true })
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className=" text-muted-foreground hover:text-destructive"
                      onClick={() => removeTopLevelItem(index)}>
                      <Trash2 />
                      <span className="sr-only">Remove condition</span>
                    </Button>
                  </div> // End Condition div
                )}
              </div> // End Item Card
            )
          })}
        </div>
      )}

      {/* Add Top-Level Condition/Group Buttons */}
      <div className="mt-4 flex gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addTopLevelCondition} // Changed from addCondition
          className="">
          <PlusCircle />
          Add Condition
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={addGroup} className="">
          <PlusCircle />
          Add Group
        </Button>
      </div>
    </div>
  )
}

// Helper function (can be moved to a utils file if needed)
// Copied from MailViewFilterCondition - Ensure consistency or centralize
function getDefaultOperatorForType(type: ConditionType): ComparisonOperator {
  switch (type) {
    case ConditionType.DATE:
      return ComparisonOperator.AFTER
    case ConditionType.SENDER:
    case ConditionType.SUBJECT:
      return ComparisonOperator.CONTAINS
    case ConditionType.TAG:
    // case ConditionType.LABEL: // Assuming LABEL is not used based on previous steps
    case ConditionType.INBOX:
    case ConditionType.ASSIGNEE:
      return ComparisonOperator.IN // Default to 'is one of' for multi-select types
    case ConditionType.STATUS:
      return ComparisonOperator.EQUALS // Default to 'Is' for status
    default:
      // Provide a fallback default operator
      return ComparisonOperator.EQUALS
  }
}
