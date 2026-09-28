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
import {
  Command,
  CommandBreadcrumb,
  CommandDetailItem,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandNavigableItem,
  CommandNavigation,
  CommandSeparator,
  type NavigationItem,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
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
  CalendarRange,
  Group,
  type LucideIcon,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { FieldItem } from '~/components/pickers/field-picker'
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
  /** The server refused the group field; shown as the orphaned-config notice. */
  groupError?: string
  /** The summary hit its 500-group cap. */
  hasMoreGroups?: boolean
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
    <div className='mx-1 mb-1 flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground'>
      <TriangleAlert className='mt-0.5 size-3.5 shrink-0' />
      <span>{children}</span>
    </div>
  )
}

type SortGroupNavigationItem = NavigationItem & {
  type: 'group-field' | 'sort-field' | 'granularity'
}

const GROUP_FIELD_ITEM: SortGroupNavigationItem = {
  id: 'group-field',
  label: 'Group by',
  type: 'group-field',
}
const SORT_FIELD_ITEM: SortGroupNavigationItem = {
  id: 'sort-field',
  label: 'Sort by',
  type: 'sort-field',
}
const GRANULARITY_ITEM: SortGroupNavigationItem = {
  id: 'granularity',
  label: 'Date grouping',
  type: 'granularity',
}

/** Searchable field list; the same `FieldItem` rows as the column manager's "Add column". */
function FieldStack({
  fields,
  fieldId,
  value,
  onSelect,
}: {
  fields: ResourceField[]
  fieldId: (field: ResourceField) => string
  value: string | undefined
  onSelect: (fieldId: string) => void
}) {
  const { pop } = useCommandNavigation<SortGroupNavigationItem>()
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const matches = query
    ? fields.filter((field) => field.label.toLowerCase().includes(query))
    : fields

  return (
    <>
      <CommandInput value={search} onValueChange={setSearch} placeholder='Search fields...' />
      <CommandList>
        <CommandEmpty>No matching fields</CommandEmpty>
        <CommandGroup>
          {matches.map((field) => {
            const id = fieldId(field)
            return (
              <FieldItem
                key={id}
                field={field}
                isSelected={id === value}
                onSelect={() => {
                  onSelect(id)
                  pop()
                }}
              />
            )
          })}
        </CommandGroup>
      </CommandList>
    </>
  )
}

/** Drill-in row showing the chosen field, like the column manager's "Add column". */
function FieldRow({
  item,
  field,
  icon: Icon,
}: {
  item: SortGroupNavigationItem
  field?: ResourceField
  icon: LucideIcon
}) {
  const { push } = useCommandNavigation<SortGroupNavigationItem>()
  return (
    <CommandNavigableItem item={item} hasChildren onSelect={push}>
      <Icon />
      <span className={cn('truncate', !field && 'text-muted-foreground')}>
        {field ? field.label : 'Choose a field'}
      </span>
    </CommandNavigableItem>
  )
}

function GranularityRow({ value }: { value: GroupDateGranularity }) {
  const { push } = useCommandNavigation<SortGroupNavigationItem>()
  const label = GROUP_DATE_GRANULARITIES.find((option) => option.value === value)?.label
  return (
    <CommandNavigableItem item={GRANULARITY_ITEM} hasChildren onSelect={push}>
      <CalendarRange />
      <span className='truncate'>By {label?.toLowerCase() ?? value}</span>
    </CommandNavigableItem>
  )
}

function GranularityStack({
  value,
  onSelect,
}: {
  value: GroupDateGranularity
  onSelect: (granularity: GroupDateGranularity) => void
}) {
  const { pop } = useCommandNavigation<SortGroupNavigationItem>()
  return (
    <CommandList>
      <CommandGroup>
        {GROUP_DATE_GRANULARITIES.map((option) => (
          <CommandDetailItem
            key={option.value}
            value={option.value}
            title={option.label}
            selectionMode='check'
            selected={option.value === value}
            onSelect={() => {
              onSelect(option.value)
              pop()
            }}
          />
        ))}
      </CommandGroup>
    </CommandList>
  )
}

/** Renders the root list, or the stack currently drilled into. */
function SortGroupStack({
  root,
  groupStack,
  sortStack,
  granularityStack,
}: {
  root: React.ReactNode
  groupStack: React.ReactNode
  sortStack: React.ReactNode
  granularityStack: React.ReactNode
}) {
  const { current } = useCommandNavigation<SortGroupNavigationItem>()
  if (current?.type === 'group-field') return groupStack
  if (current?.type === 'sort-field') return sortStack
  if (current?.type === 'granularity') return granularityStack
  return root
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
  groupError,
  hasMoreGroups = false,
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
  const isOrphanedGroup = !!activeGroup && (!activeGroupField || !!groupError)
  const appliedGroupField = groupError ? undefined : activeGroupField

  const directionOptions = getSortOptionsForFieldType(activeField?.fieldType)

  const handleFieldChange = useCallback(
    (fieldId: string) => {
      if (fieldId === active?.id) return
      // Keep the current direction when swapping fields; default to ascending.
      onSortingChange([{ id: fieldId, desc: active?.desc ?? false }])
    },
    [onSortingChange, active?.id, active?.desc]
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
      if (fieldId === activeGroup?.fieldId) return
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
    (dateGranularity: GroupDateGranularity) => {
      if (activeGroup) onGroupByChange({ ...activeGroup, dateGranularity })
    },
    [activeGroup, onGroupByChange]
  )

  const handleClearGroup = useCallback(() => {
    onGroupByChange(undefined)
  }, [onGroupByChange])

  const tooltip =
    [
      appliedGroupField && `Grouped by ${appliedGroupField.label}`,
      activeField && `Sorted by ${activeField.label}`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Sort and group rows'

  const hasActive = !!appliedGroupField || !!activeField
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
                    {appliedGroupField && (
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

      <PopoverContent className='w-[280px] p-0' align='start'>
        <CommandNavigation<SortGroupNavigationItem>>
          <Command shouldFilter={false}>
            <CommandBreadcrumb rootLabel='Sort & group' />
            <SortGroupStack
              root={
                <CommandList>
                  {allowGrouping && (
                    <>
                      <CommandGroup heading='Group by'>
                        {isOrphanedGroup && (
                          <OrphanedNotice>
                            {activeGroupField
                              ? `This field can no longer be grouped by (${groupError}), so grouping is not being applied.`
                              : 'This view groups by a field that is no longer available, so it is not being applied.'}
                          </OrphanedNotice>
                        )}
                        {hasMoreGroups && !isOrphanedGroup && (
                          <p className='px-2 pb-1 text-xs text-muted-foreground'>
                            Showing the first 500 groups
                          </p>
                        )}
                        <FieldRow item={GROUP_FIELD_ITEM} field={activeGroupField} icon={Group} />
                        {activeGroupField &&
                          groupDirectionOptions(activeGroupField).map((option) => (
                            <CommandDetailItem
                              key={String(option.desc)}
                              value={`group-${option.desc ? 'desc' : 'asc'}`}
                              icon={<option.icon />}
                              title={option.label}
                              selectionMode='check'
                              selected={(activeGroup!.desc ?? false) === option.desc}
                              onSelect={() => handleGroupDirection(option.desc)}
                            />
                          ))}
                        {activeGroupField && isDateGroupField(activeGroupField) && (
                          <GranularityRow value={activeGroup!.dateGranularity ?? 'day'} />
                        )}
                        {activeGroup && (
                          <CommandDetailItem
                            value='group-clear'
                            icon={<X />}
                            title='Clear group'
                            onSelect={handleClearGroup}
                          />
                        )}
                      </CommandGroup>
                      <CommandSeparator />
                    </>
                  )}

                  <CommandGroup heading='Sort by'>
                    {isOrphanedSort && (
                      <OrphanedNotice>
                        This view sorts by a field that is no longer available, so it is not being
                        applied.
                      </OrphanedNotice>
                    )}
                    <FieldRow item={SORT_FIELD_ITEM} field={activeField} icon={ArrowDownUp} />
                    {activeField &&
                      directionOptions.map((option) => (
                        <CommandDetailItem
                          key={option.value}
                          value={`sort-${option.value}`}
                          icon={<option.icon />}
                          title={option.label}
                          selectionMode='check'
                          selected={active!.desc === (option.value === 'desc')}
                          onSelect={() => handleDirection(option.value === 'desc')}
                        />
                      ))}
                    {active && (
                      <CommandDetailItem
                        value='sort-clear'
                        icon={<X />}
                        title='Clear sort'
                        onSelect={handleClear}
                      />
                    )}
                  </CommandGroup>
                </CommandList>
              }
              groupStack={
                <FieldStack
                  fields={groupableFields}
                  fieldId={fieldSortId}
                  value={appliedGroupField ? activeGroup?.fieldId : undefined}
                  onSelect={handleGroupFieldChange}
                />
              }
              sortStack={
                <FieldStack
                  fields={eligibleFields}
                  fieldId={fieldSortId}
                  value={activeField ? active?.id : undefined}
                  onSelect={handleFieldChange}
                />
              }
              granularityStack={
                <GranularityStack
                  value={activeGroup?.dateGranularity ?? 'day'}
                  onSelect={handleGranularity}
                />
              }
            />
          </Command>
        </CommandNavigation>
      </PopoverContent>
    </Popover>
  )
}
