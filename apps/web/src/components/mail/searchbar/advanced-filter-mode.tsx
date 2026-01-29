// apps/web/src/components/mail/searchbar/advanced-filter-mode.tsx
'use client'

import React, { useState, useRef, useMemo } from 'react'
import { v4 as generateId } from 'uuid'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Calendar } from '@auxx/ui/components/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { AssigneePicker } from '~/components/pickers/assignee-picker'
import { ParticipantPicker } from '~/components/pickers/participant-picker'
import { TagPicker } from '~/components/pickers/tag-picker'
import { SelectedTagsDisplay } from '~/components/pickers/tag-display'
import { InboxPicker } from '~/components/pickers/inbox-picker'
import { CalendarIcon, Search, X } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@auxx/ui/lib/utils'
import { IsOperatorValue } from '@auxx/lib/mail-query/client'
import { useInbox } from '~/hooks/use-inbox'
import { Badge } from '@auxx/ui/components/badge'
import type { SearchCondition } from './store'

/**
 * Props for AdvancedFilterMode component
 */
interface AdvancedFilterModeProps {
  initialConditions?: SearchCondition[]
  onApply: (conditions: SearchCondition[]) => void
  onCancel: () => void
  className?: string
}

/**
 * Helper to find a condition value by fieldId
 */
function getConditionValue(conditions: SearchCondition[], fieldId: string): any {
  const condition = conditions.find((c) => c.fieldId === fieldId)
  return condition?.value
}

/**
 * Helper to create or update a condition
 */
function setConditionValue(
  conditions: SearchCondition[],
  fieldId: string,
  operator: string,
  value: any,
  displayLabel?: string
): SearchCondition[] {
  // Remove condition if value is empty
  if (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return conditions.filter((c) => c.fieldId !== fieldId)
  }

  const existingIndex = conditions.findIndex((c) => c.fieldId === fieldId)
  if (existingIndex !== -1) {
    // Update existing
    const updated = [...conditions]
    updated[existingIndex] = { ...updated[existingIndex], value, displayLabel }
    return updated
  }

  // Add new
  return [
    ...conditions,
    {
      id: generateId(),
      fieldId,
      operator,
      value,
      displayLabel,
    },
  ]
}

/**
 * AdvancedFilterMode - Form-based filter interface for advanced searching.
 * Works with SearchCondition[] format.
 */
export function AdvancedFilterMode({
  initialConditions = [],
  onApply,
  onCancel,
  className,
}: AdvancedFilterModeProps) {
  const [conditions, setConditions] = useState<SearchCondition[]>(initialConditions)
  const [datePickerOpen, setDatePickerOpen] = useState<'before' | 'after' | null>(null)
  const [isTagOpen, setIsTagOpen] = useState(false)
  const tagButtonRef = useRef<HTMLButtonElement>(null)

  const { inboxes } = useInbox()

  // Derived values from conditions
  const fromValue = getConditionValue(conditions, 'from') as string[] | undefined
  const toValue = getConditionValue(conditions, 'to') as string[] | undefined
  const subjectValue = getConditionValue(conditions, 'subject') as string | undefined
  const bodyValue = getConditionValue(conditions, 'body') as string | undefined
  const assigneeValue = getConditionValue(conditions, 'assignee') as string[] | undefined
  const tagValue = getConditionValue(conditions, 'tag') as string[] | undefined
  const inboxValue = getConditionValue(conditions, 'inbox') as string[] | undefined
  const statusValue = getConditionValue(conditions, 'status') as string | undefined
  const beforeValue = getConditionValue(conditions, 'before') as string | undefined
  const afterValue = getConditionValue(conditions, 'after') as string | undefined
  const hasAttachmentsValue = getConditionValue(conditions, 'hasAttachments') as boolean | undefined

  // Parse date strings to Date objects
  const beforeDate = beforeValue ? new Date(beforeValue) : undefined
  const afterDate = afterValue ? new Date(afterValue) : undefined

  /** Update a filter field */
  const updateField = (fieldId: string, operator: string, value: any, displayLabel?: string) => {
    setConditions((prev) => setConditionValue(prev, fieldId, operator, value, displayLabel))
  }

  /** Handle apply */
  const handleApply = () => {
    let next = [...conditions]

    // Auto-swap inverted dates
    const beforeCond = next.find((c) => c.fieldId === 'before')
    const afterCond = next.find((c) => c.fieldId === 'after')
    if (beforeCond && afterCond) {
      const beforeDt = new Date(beforeCond.value)
      const afterDt = new Date(afterCond.value)
      if (afterDt > beforeDt) {
        beforeCond.value = afterCond.value
        afterCond.value = beforeCond.value
      }
    }

    onApply(next)
  }

  // Check if any filters are active
  const hasActiveFilters = conditions.length > 0

  return (
    <>
      <div className={cn('p-4 space-y-4', className)}>
        {/* Participants */}
        <div className="space-y-3">
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <Label className="w-20 text-sm">From</Label>
              <ParticipantPicker
                selected={fromValue}
                onChange={(selected) =>
                  updateField('from', 'contains', selected.length > 0 ? selected : undefined)
                }
                allowMultiple
                style={{ width: 'var(--radix-popover-trigger-width)' }}
                sideOffset={-30}
                align="start"
                type="from"
                placeholder="Select senders..."
                className="flex-1"
                size="sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <Label className="w-20 text-sm">To</Label>
              <ParticipantPicker
                selected={toValue}
                onChange={(selected) =>
                  updateField('to', 'contains', selected.length > 0 ? selected : undefined)
                }
                allowMultiple
                type="to"
                style={{ width: 'var(--radix-popover-trigger-width)' }}
                sideOffset={-30}
                align="start"
                placeholder="Select recipients..."
                className="flex-1"
                size="sm"
              />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="w-20 text-sm">Subject</Label>
            <Input
              value={subjectValue || ''}
              onChange={(e) => updateField('subject', 'contains', e.target.value || undefined)}
              placeholder="Enter subject text..."
              className="flex-1"
              size="sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Label className="w-20 text-sm">Body</Label>
            <Input
              value={bodyValue || ''}
              onChange={(e) => updateField('body', 'contains', e.target.value || undefined)}
              placeholder="Enter body text..."
              className="flex-1"
              size="sm"
            />
          </div>
        </div>

        {/* Organization */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="w-20 text-sm">Assignee</Label>
            <AssigneePicker
              selected={assigneeValue}
              onChange={(selected) => {
                const assigneeValues = selected.map((m) => m.email || m.id)
                updateField(
                  'assignee',
                  'in',
                  assigneeValues.length > 0 ? assigneeValues : undefined
                )
              }}
              allowMultiple
              align="start"
              placeholder="Select assignees..."
              className="flex-1 bg-primary-50 px-3"
              style={{ width: 'var(--radix-popover-trigger-width)' }}
              sideOffset={-32}
              size="sm"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="w-20 text-sm">Tags</Label>
              <div className="flex-1">
                <Button
                  ref={tagButtonRef}
                  variant="input"
                  className="w-full justify-start overflow-y-auto flex-nowrap flex-row"
                  size="sm"
                  onClick={() => setIsTagOpen(true)}>
                  {tagValue && tagValue.length > 0 ? (
                    <SelectedTagsDisplay
                      tagIds={tagValue}
                      maxDisplay={2}
                      className="flex-1 flex-nowrap"
                    />
                  ) : (
                    <span className="text-muted-foreground">Select tags...</span>
                  )}
                </Button>
                {isTagOpen && (
                  <TagPicker
                    open={isTagOpen}
                    onOpenChange={setIsTagOpen}
                    anchorRef={tagButtonRef}
                    selectedTags={tagValue || []}
                    onChange={(tags) => {
                      updateField('tag', 'in', tags.length > 0 ? tags : undefined)
                    }}
                    align="start"
                    style={{ width: 'var(--radix-popover-trigger-width)' }}
                    sideOffset={-30}
                    allowMultiple
                    className="flex-1"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Label className="w-20 text-sm">Inbox</Label>
            <div className="flex-1">
              <InboxPicker
                selected={inboxValue}
                onChange={(inbox) =>
                  updateField('inbox', 'in', inbox.length > 0 ? inbox : undefined)
                }
                align="start"
                style={{ width: 'var(--radix-popover-trigger-width)' }}
                sideOffset={-30}
                allowMultiple
                className="flex-1">
                <Button
                  variant="input"
                  size="sm"
                  className="w-full justify-start overflow-y-auto flex-nowrap ">
                  {inboxValue && inboxValue.length > 0 ? (
                    <span className="shrink-0 flex-row gap-0.5 flex">
                      {inboxValue.map((inboxId) => {
                        const inbox = inboxes?.find((i) => i.id === inboxId)
                        return (
                          <Badge key={inboxId} variant="pill" size="sm">
                            {inbox?.name || inboxId}
                          </Badge>
                        )
                      })}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Select inboxes...</span>
                  )}
                </Button>
              </InboxPicker>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2">
          <Label className="w-20 text-sm">Status</Label>
          <Select
            value={statusValue || ''}
            onValueChange={(value) =>
              updateField('status', 'is', value && value !== 'any' ? value : undefined)
            }>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select status..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any status</SelectItem>
              {Object.values(IsOperatorValue).map((status) => (
                <SelectItem key={status} value={status}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Dates */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="w-20 text-sm">After</Label>
            <Popover
              open={datePickerOpen === 'after'}
              onOpenChange={(open) => setDatePickerOpen(open ? 'after' : null)}>
              <PopoverTrigger asChild>
                <Button
                  variant="input"
                  className={cn(
                    'flex-1 justify-start text-left font-normal',
                    !afterDate && 'text-muted-foreground'
                  )}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {afterDate ? format(afterDate, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={afterDate}
                  onSelect={(date) => {
                    updateField('after', 'after', date ? date.toISOString() : undefined)
                    setDatePickerOpen(null)
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center gap-2">
            <Label className="w-20 text-sm">Before</Label>
            <Popover
              open={datePickerOpen === 'before'}
              onOpenChange={(open) => setDatePickerOpen(open ? 'before' : null)}>
              <PopoverTrigger asChild>
                <Button
                  variant="input"
                  className={cn(
                    'flex-1 justify-start text-left font-normal',
                    !beforeDate && 'text-muted-foreground'
                  )}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {beforeDate ? format(beforeDate, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={beforeDate}
                  onSelect={(date) => {
                    updateField('before', 'before', date ? date.toISOString() : undefined)
                    setDatePickerOpen(null)
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Properties */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="has-attachment"
            checked={hasAttachmentsValue || false}
            onCheckedChange={(checked) =>
              updateField('hasAttachments', 'is', checked ? true : undefined)
            }
          />
          <Label htmlFor="has-attachment" className="text-sm cursor-pointer">
            Has attachments
          </Label>
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-4 border-t">
          <div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={() => setConditions([])}>
                Clear All
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={handleApply} size="sm">
              Apply Filters
              {hasActiveFilters && (
                <span className="px-1.5 py-0.5 bg-white/30 text-background text-xs rounded">
                  {conditions.length}
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
