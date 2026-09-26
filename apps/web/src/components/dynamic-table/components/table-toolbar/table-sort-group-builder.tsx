// apps/web/src/components/dynamic-table/components/table-toolbar/table-sort-group-builder.tsx

'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import {
  GROUP_DATE_GRANULARITIES,
  isDateGroupField,
  isGroupableField,
} from '@auxx/lib/resources/grouping/client'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { cn } from '@auxx/ui/lib/utils'
import type { SortingState } from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowDownUp,
  ArrowDownZA,
  ArrowUp,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
  Group,
  type LucideIcon,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { type FieldDefinition, ResourceFieldSelector } from '~/components/conditions'
import { Tooltip } from '~/components/global/tooltip'
import type { GroupByConfig, GroupDateGranularity } from '../../types'
import { getSortOptionsForFieldType } from '../../utils/constants'

interface TableSortGroupBuilderProps {
  /** Current sorting from the view/session config. */
  sorting: SortingState
  onSortingChange: (sorting: SortingState) => void
  /** The resource's sortable fields, before this component's own eligibility pass. */
  sortableFields: ResourceField[]
  /** entityDefinitionId — used to build the ResourceFieldId a sort/group is keyed by. */
  resourceType: string
  /** False hides the GROUP BY section (system resources, non-table views). */
  allowGrouping: boolean
  groupBy: GroupByConfig | undefined
  onGroupByChange: (groupBy: GroupByConfig | undefined) => void
  disabled?: boolean
}

const DEFAULT_DATE_GRANULARITY: GroupDateGranularity = 'month'

/** Group direction labels read by field type (plans/table/group-by-plan.md §5.5). */
function groupDirectionOptions(
  field: ResourceField
): Array<{ desc: boolean; label: string; icon: LucideIcon }> {
  if (isDateGroupField(field)) {
    return [
      { desc: false, label: 'Oldest first', icon: CalendarArrowUp },
      { desc: true, label: 'Newest first', icon: CalendarArrowDown },
    ]
  }
  if (field.fieldType === 'SINGLE_SELECT') {
    return [
      { desc: false, label: 'Option order', icon: ArrowUp },
      { desc: true, label: 'Option order', icon: ArrowDown },
    ]
  }
  return [
    { desc: false, label: 'A → Z', icon: ArrowUpAZ },
    { desc: true, label: 'Z → A', icon: ArrowDownZA },
  ]
}

function OrphanedNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground'>
      <TriangleAlert className='mt-0.5 size-3.5 shrink-0' />
      <span>{children}</span>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className='px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
      {children}
    </div>
  )
}

/**
 * The toolbar's Sort & group control. Single sort by design (both query lanes read
 * `sorting[0]`); both sections apply immediately, unlike the buffered filter popover.
 */
export function TableSortGroupBuilder({
  sorting,
  onSortingChange,
  sortableFields,
  resourceType,
  allowGrouping,
  groupBy,
  onGroupByChange,
  disabled = false,
}: TableSortGroupBuilderProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Only offer what the server will actually apply: `buildOrderBySql` ignores
  // non-sortable, hidden and relationship fields, so they would look like a no-op.
  const eligibleFields = useMemo(
    () =>
      sortableFields.filter(
        (field) =>
          field.active !== false &&
          !field.capabilities?.hidden &&
          field.fieldType !== 'RELATIONSHIP'
      ),
    [sortableFields]
  )

  const groupableFields = useMemo(() => sortableFields.filter(isGroupableField), [sortableFields])

  /** Sorts and groups are keyed by the column id, which is always a ResourceFieldId. */
  const fieldSortId = useCallback(
    (field: ResourceField): string =>
      field.resourceFieldId ?? toResourceFieldId(resourceType, toFieldId(field.id as string)),
    [resourceType]
  )

  const toDefinitions = useCallback(
    (fields: ResourceField[]): FieldDefinition[] =>
      fields.map((field) => ({
        id: fieldSortId(field),
        label: field.label,
        type: field.type,
        fieldType: field.fieldType,
        fieldKey: field.key,
      })),
    [fieldSortId]
  )
  const sortDefinitions = useMemo(
    () => toDefinitions(eligibleFields),
    [toDefinitions, eligibleFields]
  )
  const groupDefinitions = useMemo(
    () => toDefinitions(groupableFields),
    [toDefinitions, groupableFields]
  )

  const active = sorting[0]
  const activeField = active
    ? eligibleFields.find((field) => fieldSortId(field) === active.id)
    : undefined
  // Still sent, silently ignored server-side — so say so and offer the way out.
  const isOrphanedSort = !!active && !activeField

  const activeGroup = allowGrouping ? groupBy : undefined
  const activeGroupField = activeGroup
    ? groupableFields.find((field) => fieldSortId(field) === activeGroup.fieldId)
    : undefined
  const isOrphanedGroup = !!activeGroup && !activeGroupField

  const directionOptions = getSortOptionsForFieldType(activeField?.fieldType)

  const handleFieldChange = useCallback(
    (fieldId: string) => {
      // Keep the current direction when swapping fields; default to ascending.
      onSortingChange([{ id: fieldId, desc: active?.desc ?? false }])
    },
    [onSortingChange, active?.desc]
  )

  const handleDirection = useCallback(
    (desc: boolean) => {
      if (!active) return
      onSortingChange([{ id: active.id, desc }])
    },
    [onSortingChange, active]
  )

  const handleClear = useCallback(() => {
    onSortingChange([])
    setIsOpen(false)
  }, [onSortingChange])

  const handleGroupFieldChange = useCallback(
    (fieldId: string) => {
      const field = groupableFields.find((candidate) => fieldSortId(candidate) === fieldId)
      if (!field) return
      onGroupByChange({
        fieldId,
        desc: activeGroup?.desc ?? false,
        dateGranularity: isDateGroupField(field)
          ? (activeGroup?.dateGranularity ?? DEFAULT_DATE_GRANULARITY)
          : undefined,
      })
    },
    [groupableFields, fieldSortId, onGroupByChange, activeGroup]
  )

  const handleGroupDirection = useCallback(
    (desc: boolean) => {
      if (activeGroup) onGroupByChange({ ...activeGroup, desc })
    },
    [activeGroup, onGroupByChange]
  )

  const handleGranularity = useCallback(
    (dateGranularity: string) => {
      if (activeGroup) {
        onGroupByChange({
          ...activeGroup,
          dateGranularity: dateGranularity as GroupDateGranularity,
        })
      }
    },
    [activeGroup, onGroupByChange]
  )

  const handleClearGroup = useCallback(() => {
    onGroupByChange(undefined)
  }, [onGroupByChange])

  const tooltip =
    [
      activeGroupField && `Grouped by ${activeGroupField.label}`,
      activeField && `Sorted by ${activeField.label}`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Sort and group rows'

  const hasActive = !!activeGroupField || !!activeField
  const SortIcon = active?.desc ? ArrowDown : ArrowUp

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div>
          <Tooltip content={tooltip}>
            <Button variant='ghost' size='sm' disabled={disabled} className='relative'>
              {/* Field names stay out of the toolbar; active state is chips (wide) or a dot. */}
              <ArrowDownUp />
              <span className='hidden @lg/controls:block'>Sort & group</span>
              {hasActive && (
                <>
                  <span className='hidden items-center gap-0.5 @lg/controls:flex'>
                    {activeGroupField && (
                      <span className='flex items-center rounded bg-accent px-1 py-0.5'>
                        <Group className='size-3' />
                      </span>
                    )}
                    {activeField && (
                      <span className='flex items-center rounded bg-accent px-1 py-0.5'>
                        <SortIcon className='size-3' />
                      </span>
                    )}
                  </span>
                  <span className='absolute right-1 bottom-1 size-1.5 rounded-full bg-info @lg/controls:hidden' />
                </>
              )}
            </Button>
          </Tooltip>
        </div>
      </PopoverTrigger>

      <PopoverContent className='w-[280px] p-2' align='start'>
        <div className='space-y-2'>
          {allowGrouping && (
            <>
              <SectionLabel>Group by</SectionLabel>
              {isOrphanedGroup && (
                <OrphanedNotice>
                  This view groups by a field that is no longer available, so it is not being
                  applied.
                </OrphanedNotice>
              )}
              <div className='px-1'>
                <ResourceFieldSelector
                  value={activeGroupField ? activeGroup!.fieldId : ''}
                  onChange={handleGroupFieldChange}
                  availableFields={groupDefinitions}
                  placeholder='Select a field to group by'
                  disabled={disabled}
                />
              </div>

              {activeGroupField && (
                <>
                  <div className='flex flex-col'>
                    {groupDirectionOptions(activeGroupField).map((option) => {
                      const OptionIcon = option.icon
                      const isActive = (activeGroup!.desc ?? false) === option.desc
                      return (
                        <Button
                          key={String(option.desc)}
                          variant='ghost'
                          size='sm'
                          className={cn('justify-start', isActive && 'bg-accent')}
                          onClick={() => handleGroupDirection(option.desc)}>
                          <OptionIcon />
                          {option.label}
                        </Button>
                      )
                    })}
                  </div>

                  {isDateGroupField(activeGroupField) && (
                    <div className='px-1'>
                      <Select
                        value={activeGroup!.dateGranularity ?? 'day'}
                        onValueChange={handleGranularity}>
                        <SelectTrigger size='sm' className='w-full'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GROUP_DATE_GRANULARITIES.map((granularity) => (
                            <SelectItem key={granularity.value} value={granularity.value}>
                              {granularity.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}

              {activeGroup && (
                <Button
                  variant='ghost'
                  size='sm'
                  className='w-full justify-start'
                  onClick={handleClearGroup}>
                  Clear group
                </Button>
              )}

              <div className='-mx-2 border-t' />
              <SectionLabel>Sort by</SectionLabel>
            </>
          )}

          {isOrphanedSort && (
            <OrphanedNotice>
              This view sorts by a field that is no longer available, so it is not being applied.
            </OrphanedNotice>
          )}

          <div className='px-1'>
            <ResourceFieldSelector
              value={activeField ? active!.id : ''}
              onChange={handleFieldChange}
              availableFields={sortDefinitions}
              placeholder='Select a field to sort by'
              disabled={disabled}
            />
          </div>

          {activeField && (
            <div className='flex flex-col'>
              {directionOptions.map((option) => {
                const OptionIcon = option.icon
                const isActive = active!.desc === (option.value === 'desc')
                return (
                  <Button
                    key={option.value}
                    variant='ghost'
                    size='sm'
                    className={cn('justify-start', isActive && 'bg-accent')}
                    onClick={() => handleDirection(option.value === 'desc')}>
                    <OptionIcon />
                    {option.label}
                  </Button>
                )
              })}
            </div>
          )}

          {active && (
            <Button
              variant='ghost'
              size='sm'
              className='w-full justify-start'
              onClick={handleClear}>
              Clear sort
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
