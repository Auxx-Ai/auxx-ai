// src/components/mail/searchbar/advanced-filter-mode.tsx
'use client'

import React, { useState } from 'react'
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
import { CalendarIcon, Filter, Search, X } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@auxx/ui/lib/utils'
import { IsOperatorValue } from '@auxx/lib/mail-query'
import { type FilterValue } from './_hooks/use-query-to-filters'
import { useInbox } from '~/hooks/use-inbox'
import { Badge } from '@auxx/ui/components/badge'

interface AdvancedFilterModeProps {
  initialFilters?: FilterValue
  onApply: (filters: FilterValue) => void
  onCancel: () => void
  onFiltersChange?: (filters: FilterValue) => void // New: real-time updates
  className?: string
}

export function AdvancedFilterMode({
  initialFilters = {},
  onApply,
  onCancel,
  onFiltersChange,
  className,
}: AdvancedFilterModeProps) {
  const [filters, setFilters] = useState<FilterValue>(initialFilters)
  const [datePickerOpen, setDatePickerOpen] = useState<'before' | 'after' | null>(null)
  const [isTagOpen, setIsTagOpen] = useState(false)

  const { inboxes } = useInbox()

  // Helper functions for equality checking
  function eqArrays(a?: string[], b?: string[]) {
    if (!a && !b) return true
    if (!a || !b || a.length !== b.length) return false
    const A = [...a].sort(),
      B = [...b].sort()
    return A.every((v, i) => v === B[i])
  }

  function shallowEq(a: FilterValue, b: FilterValue) {
    return (
      a.subject === b.subject &&
      a.body === b.body &&
      a.hasAttachment === b.hasAttachment &&
      eqArrays(a.from, b.from) &&
      eqArrays(a.to, b.to) &&
      eqArrays(a.assignee, b.assignee) &&
      eqArrays(a.tag, b.tag) &&
      eqArrays(a.inbox, b.inbox) &&
      eqArrays(a.is, b.is) &&
      (a.before?.toDateString() ?? '') === (b.before?.toDateString() ?? '') &&
      (a.after?.toDateString() ?? '') === (b.after?.toDateString() ?? '')
    )
  }

  // Update filters when initialFilters change (for synchronization)
  React.useEffect(() => {
    setFilters((prev) => (shallowEq(prev, initialFilters) ? prev : initialFilters))
  }, [initialFilters])
  const updateFilter = <K extends keyof FilterValue>(key: K, value: FilterValue[K]) => {
    setFilters((prev) => {
      const newFilters = { ...prev, [key]: value }
      // Notify parent of changes for real-time sync
      onFiltersChange?.(newFilters)
      return newFilters
    })
  }

  const handleApply = () => {
    let next = { ...filters }
    if (next.before && next.after && next.after > next.before) {
      // Auto-swap inverted dates
      const tmp = next.after
      next.after = next.before
      next.before = tmp
    }
    onApply(next)
  }

  // Check if any filters are active
  const hasActiveFilters = Object.values(filters).some((value) => {
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'boolean') return value
    if (value instanceof Date) return true
    return !!value
  })

  return (
    <>
      <div className="flex items-center border-b ps-3 relative">
        <Search className="mr-2 size-4 shrink-0 opacity-50 ml-[-1px]" />
        <div className="flex-1 bg-transparent border-0 focus:ring-0 focus-visible:ring-0 text-sm py-1">
          Apply filters
        </div>
        <Button
          variant="ghost"
          aria-selected="true"
          className={cn(
            'absolute right-[4px] size-6 rounded-full bg-primary-200 hover:bg-primary-200'
          )}
          onClick={onCancel}>
          <X className="size-4 shrink-0 opacity-50" />
        </Button>
      </div>
      <div className={cn('p-4 space-y-4', className)}>
        {/* Participants */}
        <div className="space-y-3">
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <Label className="w-20 text-sm">From</Label>
              <ParticipantPicker
                selected={filters.from}
                onChange={(selected) =>
                  updateFilter('from', selected.length > 0 ? selected : undefined)
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
                selected={filters.to}
                onChange={(selected) =>
                  updateFilter('to', selected.length > 0 ? selected : undefined)
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
              value={filters.subject || ''}
              onChange={(e) => updateFilter('subject', e.target.value || undefined)}
              placeholder="Enter subject text..."
              className="flex-1"
              size="sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Label className="w-20 text-sm">Body</Label>
            <Input
              value={filters.body || ''}
              onChange={(e) => updateFilter('body', e.target.value || undefined)}
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
              selected={filters.assignee}
              onChange={(selected) => {
                const assigneeValues = selected.map((m) => m.email || m.id)
                updateFilter('assignee', assigneeValues.length > 0 ? assigneeValues : undefined)
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
                <Popover open={isTagOpen} onOpenChange={setIsTagOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="input"
                      className="w-full justify-start overflow-y-auto flex-nowrap flex-row"
                      size="sm">
                      {filters.tag && filters.tag.length > 0 ? (
                        <SelectedTagsDisplay
                          tagIds={filters.tag}
                          maxDisplay={2}
                          className="flex-1 flex-nowrap"
                        />
                      ) : (
                        <span className="text-muted-foreground">Select tags...</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <TagPicker
                    open={isTagOpen}
                    align="start"
                    onOpenChange={setIsTagOpen}
                    selectedTags={filters.tag || []}
                    onChange={(tags) => {
                      updateFilter('tag', tags.length > 0 ? tags : undefined)
                    }}
                    style={{ width: 'var(--radix-popover-trigger-width)' }}
                    sideOffset={-30}
                    allowMultiple
                    className="flex-1"
                  />
                </Popover>
              </div>
            </div>

            {/* Display all selected tags with remove option */}
            {/* {filters.tag && filters.tag.length > 0 && (
            <div className="ml-[5rem]">
              <SelectedTagsDisplay
                tagIds={filters.tag}
                showRemove
                onRemove={(tagId) => {
                  const updatedTags = filters.tag?.filter((id) => id !== tagId) || []
                  updateFilter('tag', updatedTags.length > 0 ? updatedTags : undefined)
                }}
                className="flex-wrap"
              />
            </div>
          )} */}
          </div>

          <div className="flex items-center gap-2">
            <Label className="w-20 text-sm">Inbox</Label>
            <div className="flex-1">
              <InboxPicker
                selected={filters.inbox}
                onChange={(inbox) => updateFilter('inbox', inbox.length > 0 ? inbox : undefined)}
                align="start"
                style={{ width: 'var(--radix-popover-trigger-width)' }}
                sideOffset={-30}
                allowMultiple
                className="flex-1">
                <Button
                  variant="input"
                  size="sm"
                  className="w-full justify-start overflow-y-auto flex-nowrap ">
                  {filters.inbox && filters.inbox.length > 0 ? (
                    <span className="shrink-0 flex-row gap-0.5 flex">
                      {filters.inbox.map((inboxId) => {
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
            value={filters.is?.[0] || ''}
            onValueChange={(value) =>
              updateFilter('is', value && value !== 'any' ? [value] : undefined)
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
                    !filters.after && 'text-muted-foreground'
                  )}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.after ? format(filters.after, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={filters.after}
                  onSelect={(date) => {
                    updateFilter('after', date || undefined)
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
                    !filters.before && 'text-muted-foreground'
                  )}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.before ? format(filters.before, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={filters.before}
                  onSelect={(date) => {
                    updateFilter('before', date || undefined)
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
            checked={filters.hasAttachment || false}
            onCheckedChange={(checked) => updateFilter('hasAttachment', checked ? true : undefined)}
          />
          <Label htmlFor="has-attachment" className="text-sm cursor-pointer">
            Has attachments
          </Label>
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-4 border-t">
          <div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters({})
                  onFiltersChange?.({})
                }}>
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
                  {
                    Object.keys(filters).filter((key) => {
                      const value = filters[key as keyof FilterValue]
                      if (Array.isArray(value)) return value.length > 0
                      if (typeof value === 'boolean') return value
                      if (value instanceof Date) return true
                      return !!value
                    }).length
                  }
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
