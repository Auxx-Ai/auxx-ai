// apps/web/src/components/mail-views/mail-view-filter-condition.tsx
'use client'

import { useState, useMemo } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Input } from '@auxx/ui/components/input'
import { ConditionType, ComparisonOperator, type FilterCondition } from '@auxx/lib/types'
import { TagPicker } from '~/components/pickers/tag-picker'
import { AssigneePicker, type TeamMember } from '~/components/pickers/assignee-picker'
import { InboxPicker } from '~/components/pickers/inbox-picker'
import { FilterDatePicker } from '~/components/pickers/filter-date-picker'
import { Popover, PopoverTrigger } from '@auxx/ui/components/popover'
import { Button } from '@auxx/ui/components/button'
import { Inbox, Tag, User } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { ThreadStatus } from '@auxx/database/enums'

/** Type for ThreadStatus values */
type ThreadStatusValue = (typeof ThreadStatus)[keyof typeof ThreadStatus]

/** Props for MailViewFilterCondition component */
interface MailViewFilterConditionProps {
  /** The condition data to display and edit */
  condition: FilterCondition
  /** Callback when the condition is updated */
  onChange: (updatedCondition: FilterCondition) => void
}

const threadStatuses = Object.values(ThreadStatus)

/**
 * Renders a single condition row within the mail view filter builder.
 */
export function MailViewFilterCondition({ condition, onChange }: MailViewFilterConditionProps) {
  const [isTagPopoverOpen, setIsTagPopoverOpen] = useState(false)
  const [isAssigneePopoverOpen, setIsAssigneePopoverOpen] = useState(false)
  const [isInboxPopoverOpen, setIsInboxPopoverOpen] = useState(false)

  // Use condition props directly instead of watching form state
  const conditionType = condition.type
  const currentOperator = condition.operator
  const currentValue = condition.value

  const operators = useMemo(() => getOperatorsForType(conditionType), [conditionType])

  /** Updates the condition type and resets operator/value to defaults */
  const updateType = (type: ConditionType) => {
    const defaultOperator = getDefaultOperatorForType(type)
    onChange({
      ...condition,
      type,
      operator: defaultOperator,
      value: null,
    })
  }

  /** Updates the operator and clears value if using IS_EMPTY/IS_NOT_EMPTY */
  const updateOperator = (operator: ComparisonOperator) => {
    const shouldClearValue =
      operator === ComparisonOperator.IS_EMPTY || operator === ComparisonOperator.IS_NOT_EMPTY
    onChange({
      ...condition,
      operator,
      value: shouldClearValue ? null : condition.value,
    })
  }

  /** Updates the condition value */
  const handleValueChange = (newValue: unknown) => {
    onChange({
      ...condition,
      value: newValue,
    })
  }
  // --- Display functions for Trigger Buttons ---
  const getTagButtonText = (selectedIds: string[] | null | undefined) => {
    if (!selectedIds || selectedIds.length === 0) return 'Select Tags...'
    if (selectedIds.length === 1) return `1 Tag selected` // Fetching name is complex here
    return `${selectedIds.length} Tags selected`
  }
  /** Returns display text for assignee picker button */
  const getAssigneeButtonText = (selectedMembers: TeamMember[] | null | undefined) => {
    if (!selectedMembers || selectedMembers.length === 0) return 'Select Assignees...'
    if (selectedMembers.length === 1) {
      const member = selectedMembers[0]
      return member?.name ?? member?.email ?? '1 Assignee'
    }
    return `${selectedMembers.length} Assignees`
  }
  const getInboxButtonText = (selectedIds: string[] | null | undefined) => {
    if (!selectedIds || selectedIds.length === 0) return 'Select Inboxes...'
    if (selectedIds.length === 1) return `1 Inbox selected` // Fetching name is complex here
    return `${selectedIds.length} Inboxes selected`
  }
  // --- Render Value Component ---
  const renderValueComponent = () => {
    // Use the watched value for display consistency
    const valueToDisplay = currentValue
    const isValueInputDisabled =
      currentOperator === ComparisonOperator.IS_EMPTY ||
      currentOperator === ComparisonOperator.IS_NOT_EMPTY
    if (isValueInputDisabled) return null
    const allowMultipleValues =
      currentOperator === ComparisonOperator.IN || currentOperator === ComparisonOperator.NOT_IN
    switch (conditionType) {
      case ConditionType.TAG:
        const selectedTagIds = (valueToDisplay as string[]) || []
        return (
          <Popover open={isTagPopoverOpen} onOpenChange={setIsTagPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="input"
                size="sm"
                className={cn(
                  'w-full justify-start text-left font-normal rounded-xl',
                  !valueToDisplay && 'text-muted-foreground'
                )}>
                <Tag />
                {getTagButtonText(selectedTagIds)}
              </Button>
            </PopoverTrigger>
            {/* TagPicker expects PopoverContent structure around it */}
            <TagPicker
              // Pass state to TagPicker if it needs external control (unlikely based on its code)
              open={isTagPopoverOpen}
              onOpenChange={setIsTagPopoverOpen}
              selectedTags={selectedTagIds}
              onChange={(tags) => {
                handleValueChange(tags)
                if (!allowMultipleValues) setIsTagPopoverOpen(false) // Close on single select
              }}
              allowMultiple={allowMultipleValues}
            />
          </Popover>
        )
      case ConditionType.ASSIGNEE:
        const selectedAssignees = (valueToDisplay as TeamMember[]) || []
        return (
          <AssigneePicker
            open={isAssigneePopoverOpen}
            onOpenChange={setIsAssigneePopoverOpen}
            // Selected expects TeamMember[], which matches our form state now
            selected={selectedAssignees}
            // onChange returns TeamMember[], store directly
            onChange={(assignees) => {
              handleValueChange(assignees)
            }}
            allowMultiple={allowMultipleValues}>
            <Button
              type="button"
              variant="input"
              size="sm"
              className={cn(
                'w-full justify-start text-left font-normal rounded-xl',
                !valueToDisplay && 'text-muted-foreground'
              )}>
              <User />
              {getAssigneeButtonText(selectedAssignees)}
            </Button>
          </AssigneePicker>
        )
      case ConditionType.INBOX:
        const selectedInboxIds = (valueToDisplay as string[]) || []
        return (
          <InboxPicker
            open={isInboxPopoverOpen}
            onOpenChange={setIsInboxPopoverOpen}
            selected={selectedInboxIds}
            onChange={(inboxes) => {
              handleValueChange(inboxes)
              // Close popover automatically if not allowing multiple
              // InboxPicker might handle this internally based on allowMultiple
              // if (!allowMultipleValues) setIsInboxPopoverOpen(false);
            }}
            allowMultiple={allowMultipleValues}>
            <Button
              type="button"
              variant="input"
              size="sm"
              className={cn(
                'w-full justify-start text-left font-normal rounded-xl',
                !valueToDisplay && 'text-muted-foreground'
              )}>
              <Inbox />
              {getInboxButtonText(selectedInboxIds)}
            </Button>
          </InboxPicker>
        )
      case ConditionType.STATUS:
        return (
          <Select
            value={valueToDisplay as ThreadStatusValue}
            onValueChange={(value: ThreadStatusValue) => handleValueChange(value)}
            disabled={isValueInputDisabled}>
            <SelectTrigger className="w-full" size="sm">
              <SelectValue placeholder="Select status..." />
            </SelectTrigger>
            <SelectContent>
              {threadStatuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {status.charAt(0) + status.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      case ConditionType.DATE:
        return (
          <FilterDatePicker
            value={valueToDisplay as string | null | undefined}
            onChange={(newValue) => handleValueChange(newValue)}
            disabled={isValueInputDisabled}
            triggerClassName="h-7 rounded-xl"
          />
        )
      case ConditionType.SENDER:
      case ConditionType.SUBJECT:
        return (
          <Input
            value={(valueToDisplay as string) || ''}
            onChange={(e) => handleValueChange(e.target.value)}
            placeholder="Enter value..."
            className="w-full"
            size="sm"
            disabled={isValueInputDisabled}
          />
        )
      default:
        return null
    }
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {/* Condition Type Selector */}
      <Select value={conditionType} onValueChange={(value) => updateType(value as ConditionType)}>
        <SelectTrigger className="w-[140px]" size="sm">
          <SelectValue placeholder="Select field" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ConditionType.INBOX}>Inbox</SelectItem>
          <SelectItem value={ConditionType.TAG}>Tag</SelectItem>
          {/* <SelectItem value={ConditionType.LABEL}>Label</SelectItem> */}
          <SelectItem value={ConditionType.ASSIGNEE}>Assignee</SelectItem>
          <SelectItem value={ConditionType.STATUS}>Status</SelectItem>
          <SelectItem value={ConditionType.DATE}>Date</SelectItem>
          <SelectItem value={ConditionType.SENDER}>Sender</SelectItem>
          <SelectItem value={ConditionType.SUBJECT}>Subject</SelectItem>
        </SelectContent>
      </Select>

      {/* Operator Selector */}
      <Select
        value={currentOperator}
        onValueChange={(value) => updateOperator(value as ComparisonOperator)}>
        <SelectTrigger className="w-[140px]" size="sm">
          <SelectValue placeholder="Select operator" />
        </SelectTrigger>
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Value Input/Selector */}
      <div className="min-w-[150px] flex-1">{renderValueComponent()}</div>
    </div>
  )
}
// --- Helper Functions (getOperatorsForType, getDefaultOperatorForType) remain the same ---
/**
 * Gets the available comparison operators for a given condition type.
 */
function getOperatorsForType(type: ConditionType): {
  value: ComparisonOperator
  label: string
}[] {
  // ... (implementation unchanged)
  // Basic equality operators
  const equalityOperators = [
    { value: ComparisonOperator.EQUALS, label: 'Is' },
    { value: ComparisonOperator.NOT_EQUALS, label: 'Is not' },
  ]
  // Operators to check if a value exists or not
  const existenceOperators = [
    { value: ComparisonOperator.IS_EMPTY, label: 'Is empty' },
    { value: ComparisonOperator.IS_NOT_EMPTY, label: 'Is not empty' },
  ]
  // Operators for text-based fields
  const textOperators = [
    ...equalityOperators,
    { value: ComparisonOperator.CONTAINS, label: 'Contains' },
    { value: ComparisonOperator.NOT_CONTAINS, label: 'Does not contain' },
    ...existenceOperators,
  ]
  // Operators for fields that can accept multiple values (e.g., tags, labels)
  const multiSelectOperators = [
    { value: ComparisonOperator.IN, label: 'Is one of' },
    { value: ComparisonOperator.NOT_IN, label: 'Is not one of' },
    ...existenceOperators,
  ]
  // Operators typically used for single-select dropdowns or unique identifiers
  const singleSelectOperators = [...equalityOperators, ...existenceOperators]
  // Operators specific to date comparisons
  const dateOperators = [
    { value: ComparisonOperator.BEFORE, label: 'Before' },
    { value: ComparisonOperator.AFTER, label: 'After' },
    { value: ComparisonOperator.EQUALS, label: 'On' },
    ...existenceOperators,
  ]
  switch (type) {
    case ConditionType.DATE:
      return dateOperators
    case ConditionType.SENDER:
    case ConditionType.SUBJECT:
      return textOperators
    case ConditionType.TAG:
    // case ConditionType.LABEL:
    case ConditionType.INBOX:
    case ConditionType.ASSIGNEE: // Allow multiple assignees
      return multiSelectOperators
    case ConditionType.STATUS: // Status is usually a single state
      return singleSelectOperators // Use IS, IS NOT, IS EMPTY, IS NOT EMPTY
    // Removed INTEGRATION case
    default:
      // Fallback for any unexpected types
      return singleSelectOperators
  }
}
/**
 * Gets the default comparison operator for a given condition type when the type is first selected.
 */
function getDefaultOperatorForType(type: ConditionType): ComparisonOperator {
  // ... (implementation unchanged)
  switch (type) {
    case ConditionType.DATE:
      return ComparisonOperator.AFTER
    case ConditionType.SENDER:
    case ConditionType.SUBJECT:
      return ComparisonOperator.CONTAINS
    case ConditionType.TAG:
    // case ConditionType.LABEL:
    case ConditionType.INBOX:
    case ConditionType.ASSIGNEE:
      return ComparisonOperator.IN // Default to 'is one of' for multi-select types
    case ConditionType.STATUS:
      return ComparisonOperator.EQUALS // Default to 'Is' for status
    // Removed INTEGRATION case
    default:
      return ComparisonOperator.EQUALS // Default for single-select or unknown types
  }
}
