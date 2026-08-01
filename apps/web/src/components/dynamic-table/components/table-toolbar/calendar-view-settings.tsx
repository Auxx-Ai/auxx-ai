// apps/web/src/components/dynamic-table/components/table-toolbar/calendar-view-settings.tsx
'use client'

import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandBreadcrumb,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandNavigableItem,
  CommandNavigation,
  CommandRadioGroup,
  CommandRadioItem,
  CommandSeparator,
  CommandSortable,
  CommandSortableItem,
  type NavigationItem,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { CalendarDays, CalendarRange, IdCard, Palette, Plus, Settings2, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useTableConfig } from '../../context/table-config-context'
import { useViewMetadata } from '../../context/view-metadata-context'
import { useUpdateCalendarConfig } from '../../stores/store-actions'
import { useCalendarConfig } from '../../stores/store-selectors'

/** Navigation item type for CalendarViewSettings */
interface SettingsNavigationItem extends NavigationItem {
  id: string
  label: string
  type: 'dateField' | 'endDateField' | 'colorField' | 'primaryField' | 'add-field'
}

/** Props for CalendarViewSettings */
interface CalendarViewSettingsProps {
  className?: string
}

/** Sentinel value for "None" radio items — clears the corresponding optional field id. */
const NONE_VALUE = '__none__'

/**
 * Root stack component - main menu with date-axis fields and card fields.
 * Mirrors `KanbanViewSettings`'s Popover + CommandNavigation shape (kanban-view-settings.tsx).
 */
function RootStack() {
  const { push } = useCommandNavigation<SettingsNavigationItem>()
  const { tableId } = useTableConfig()
  const { customFields, dateFields, selectFields } = useViewMetadata()

  const calendarConfig = useCalendarConfig(tableId)
  const updateCalendarConfig = useUpdateCalendarConfig(tableId)

  const cardFields = calendarConfig?.cardFields ?? []

  const dateField = useMemo(
    () => dateFields?.find((f) => f.id === calendarConfig?.dateFieldId),
    [dateFields, calendarConfig?.dateFieldId]
  )
  const endDateField = useMemo(
    () => dateFields?.find((f) => f.id === calendarConfig?.endDateFieldId),
    [dateFields, calendarConfig?.endDateFieldId]
  )
  const colorField = useMemo(
    () => selectFields?.find((f) => f.id === calendarConfig?.colorFieldId),
    [selectFields, calendarConfig?.colorFieldId]
  )
  const primaryField = useMemo(
    () => customFields?.find((f) => f.id === calendarConfig?.primaryFieldId),
    [customFields, calendarConfig?.primaryFieldId]
  )

  /** Navigate to a sub-stack */
  const handleNavigate = useCallback(
    (type: SettingsNavigationItem['type'], label: string) => {
      push({ id: type, label, type })
    },
    [push]
  )

  /** Handle card fields reorder (optimistic via store) */
  const handleCardFieldsReorder = useCallback(
    (newOrder: string[]) => {
      updateCalendarConfig({ cardFields: newOrder })
    },
    [updateCalendarConfig]
  )

  /** Handle removing a card field (optimistic via store) */
  const handleRemoveCardField = useCallback(
    (fieldId: string) => {
      updateCalendarConfig({
        cardFields: cardFields.filter((id) => id !== fieldId),
      })
    },
    [cardFields, updateCalendarConfig]
  )

  return (
    <CommandList>
      {/* View Settings Group */}
      <CommandGroup heading='View Settings'>
        <CommandNavigableItem
          item={{ id: 'dateField', label: 'Date field', type: 'dateField' }}
          hasChildren
          onSelect={() => handleNavigate('dateField', 'Date field')}>
          <CalendarDays />
          <span className='flex-1'>Date field</span>
          <span className='text-xs text-muted-foreground truncate max-w-24'>
            {dateField?.name ?? 'Not set'}
          </span>
        </CommandNavigableItem>

        <CommandNavigableItem
          item={{ id: 'endDateField', label: 'End date field', type: 'endDateField' }}
          hasChildren
          onSelect={() => handleNavigate('endDateField', 'End date field')}>
          <CalendarRange />
          <span className='flex-1'>End date field</span>
          <span className='text-xs text-muted-foreground truncate max-w-24'>
            {endDateField?.name ?? 'Not set'}
          </span>
        </CommandNavigableItem>

        <CommandNavigableItem
          item={{ id: 'colorField', label: 'Color field', type: 'colorField' }}
          hasChildren
          onSelect={() => handleNavigate('colorField', 'Color field')}>
          <Palette />
          <span className='flex-1'>Color field</span>
          <span className='text-xs text-muted-foreground truncate max-w-24'>
            {colorField?.name ?? 'Not set'}
          </span>
        </CommandNavigableItem>

        <CommandNavigableItem
          item={{ id: 'primaryField', label: 'Primary field', type: 'primaryField' }}
          hasChildren
          onSelect={() => handleNavigate('primaryField', 'Primary field')}>
          <IdCard />
          <span className='flex-1'>Primary field</span>
          <span className='text-xs text-muted-foreground truncate max-w-24'>
            {primaryField?.name ?? 'Not set'}
          </span>
        </CommandNavigableItem>
      </CommandGroup>

      <CommandSeparator />
      {/* Card Fields Group - Sortable */}
      <CommandGroup heading='Card Fields'>
        {cardFields.length === 0 ? (
          <div className='text-sm text-muted-foreground px-2'>No card fields configured</div>
        ) : (
          <CommandSortable items={cardFields} onReorder={handleCardFieldsReorder}>
            {cardFields.map((fieldId) => {
              const field = customFields?.find((f) => f.id === fieldId)
              return (
                <CommandSortableItem key={fieldId} id={fieldId} className='py-0 pe-0.5'>
                  <span className='truncate flex-1 flex items-center'>
                    {field?.name ?? fieldId}
                  </span>
                  <button
                    type='button'
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveCardField(fieldId)
                    }}
                    className='shrink-0  size-6.5 flex items-center justify-center rounded-full hover:bg-bad-100 hover:text-bad-500'>
                    <Trash2 className='size-3' />
                  </button>
                </CommandSortableItem>
              )
            })}
          </CommandSortable>
        )}
      </CommandGroup>

      <CommandSeparator />

      {/* Add Card Field */}
      <CommandGroup>
        <CommandNavigableItem
          item={{ id: 'add-field', label: 'Add card field', type: 'add-field' }}
          hasChildren
          onSelect={() => handleNavigate('add-field', 'Add card field')}>
          <Plus />
          <span>Add card field</span>
        </CommandNavigableItem>
      </CommandGroup>
    </CommandList>
  )
}

/** Date field selection stack - required, no clear option. */
function DateFieldStack() {
  const { tableId } = useTableConfig()
  const { dateFields } = useViewMetadata()

  const calendarConfig = useCalendarConfig(tableId)
  const updateCalendarConfig = useUpdateCalendarConfig(tableId)

  const handleSelectField = useCallback(
    (fieldId: string) => {
      updateCalendarConfig({ dateFieldId: fieldId })
    },
    [updateCalendarConfig]
  )

  return (
    <CommandList>
      <CommandGroup>
        <div className='text-xs text-muted-foreground px-2 pb-1'>
          Records are placed on the month grid by this field. Multi-value date fields use their
          first value.
        </div>
      </CommandGroup>
      <CommandSeparator />
      <CommandRadioGroup value={calendarConfig?.dateFieldId} onValueChange={handleSelectField}>
        {(dateFields ?? []).map((field) => (
          <CommandRadioItem key={field.id} value={field.id}>
            {field.name}
          </CommandRadioItem>
        ))}
      </CommandRadioGroup>
      {(dateFields ?? []).length === 0 && (
        <CommandEmpty>No DATE or DATETIME fields on this entity</CommandEmpty>
      )}
    </CommandList>
  )
}

/** End date field selection stack - nullable (clears the span back to a point-in-time chip). */
function EndDateFieldStack() {
  const { tableId } = useTableConfig()
  const { dateFields } = useViewMetadata()

  const calendarConfig = useCalendarConfig(tableId)
  const updateCalendarConfig = useUpdateCalendarConfig(tableId)

  const handleSelectField = useCallback(
    (fieldId: string) => {
      updateCalendarConfig({ endDateFieldId: fieldId === NONE_VALUE ? undefined : fieldId })
    },
    [updateCalendarConfig]
  )

  return (
    <CommandList>
      <CommandRadioGroup
        value={calendarConfig?.endDateFieldId ?? NONE_VALUE}
        onValueChange={handleSelectField}>
        <CommandRadioItem value={NONE_VALUE}>None</CommandRadioItem>
        {(dateFields ?? [])
          .filter((f) => f.id !== calendarConfig?.dateFieldId)
          .map((field) => (
            <CommandRadioItem key={field.id} value={field.id}>
              {field.name}
            </CommandRadioItem>
          ))}
      </CommandRadioGroup>
    </CommandList>
  )
}

/** Color field selection stack - SINGLE_SELECT only, nullable. */
function ColorFieldStack() {
  const { tableId } = useTableConfig()
  const { selectFields } = useViewMetadata()

  const calendarConfig = useCalendarConfig(tableId)
  const updateCalendarConfig = useUpdateCalendarConfig(tableId)

  const handleSelectField = useCallback(
    (fieldId: string) => {
      updateCalendarConfig({ colorFieldId: fieldId === NONE_VALUE ? undefined : fieldId })
    },
    [updateCalendarConfig]
  )

  return (
    <CommandList>
      <CommandRadioGroup
        value={calendarConfig?.colorFieldId ?? NONE_VALUE}
        onValueChange={handleSelectField}>
        <CommandRadioItem value={NONE_VALUE}>None</CommandRadioItem>
        {(selectFields ?? []).map((field) => (
          <CommandRadioItem key={field.id} value={field.id}>
            {field.name}
          </CommandRadioItem>
        ))}
      </CommandRadioGroup>
      {(selectFields ?? []).length === 0 && (
        <CommandEmpty>No SINGLE_SELECT fields on this entity</CommandEmpty>
      )}
    </CommandList>
  )
}

/** Primary (title) field selection stack - nullable, falls back to the entity's identity field. */
function PrimaryFieldStack() {
  const { tableId } = useTableConfig()
  const { customFields } = useViewMetadata()

  const calendarConfig = useCalendarConfig(tableId)
  const updateCalendarConfig = useUpdateCalendarConfig(tableId)

  const handleSelectField = useCallback(
    (fieldId: string) => {
      updateCalendarConfig({ primaryFieldId: fieldId === NONE_VALUE ? undefined : fieldId })
    },
    [updateCalendarConfig]
  )

  return (
    <CommandList>
      <CommandRadioGroup
        value={calendarConfig?.primaryFieldId ?? NONE_VALUE}
        onValueChange={handleSelectField}>
        <CommandRadioItem value={NONE_VALUE}>Entity default</CommandRadioItem>
        {(customFields ?? []).map((field) => (
          <CommandRadioItem key={field.id} value={field.id}>
            {field.name}
          </CommandRadioItem>
        ))}
      </CommandRadioGroup>
    </CommandList>
  )
}

/** Add card field stack - search and add fields to cards (mirrors kanban's `AddCardFieldStack`). */
function AddCardFieldStack() {
  const { tableId } = useTableConfig()
  const { customFields } = useViewMetadata()

  const calendarConfig = useCalendarConfig(tableId)
  const updateCalendarConfig = useUpdateCalendarConfig(tableId)
  const [search, setSearch] = useState('')

  const cardFields = calendarConfig?.cardFields ?? []

  /** Fields available to add (not already in cardFields) */
  const availableFields = useMemo(() => {
    const currentFieldIds = new Set(cardFields)
    return (customFields ?? []).filter((f) => !currentFieldIds.has(f.id))
  }, [customFields, cardFields])

  /** Filtered fields based on search */
  const filteredFields = useMemo(() => {
    if (!search) return availableFields
    const query = search.toLowerCase()
    return availableFields.filter((f) => (f.name ?? f.label).toLowerCase().includes(query))
  }, [availableFields, search])

  /** Handle adding a field */
  const handleAddField = useCallback(
    (fieldId: string) => {
      updateCalendarConfig({
        cardFields: [...cardFields, fieldId],
      })
    },
    [cardFields, updateCalendarConfig]
  )

  return (
    <>
      <CommandInput placeholder='Search fields...' value={search} onValueChange={setSearch} />
      <CommandList>
        <CommandEmpty>No fields found.</CommandEmpty>
        {filteredFields.length > 0 && (
          <CommandGroup>
            {filteredFields.map((field) => (
              <CommandItem
                key={field.id}
                value={field.id}
                onSelect={() => handleAddField(field.id)}
                className='ps-0.5 py-0'>
                <EntityIcon
                  iconId={field.fieldType ? fieldTypeOptions[field.fieldType].iconId : 'circle'}
                  variant='default'
                  size='default'
                />
                {field.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </>
  )
}

/**
 * Main content component that renders based on navigation state
 */
function CalendarViewSettingsContent() {
  const { current } = useCommandNavigation<SettingsNavigationItem>()

  if (current?.type === 'dateField') {
    return <DateFieldStack />
  }
  if (current?.type === 'endDateField') {
    return <EndDateFieldStack />
  }
  if (current?.type === 'colorField') {
    return <ColorFieldStack />
  }
  if (current?.type === 'primaryField') {
    return <PrimaryFieldStack />
  }
  if (current?.type === 'add-field') {
    return <AddCardFieldStack />
  }

  return <RootStack />
}

/**
 * CalendarViewSettings component
 * Manages calendar-specific view settings — date axis (start/end), chip color,
 * primary (title) field, and card fields — mirroring `KanbanViewSettings`'s shape.
 */
export function CalendarViewSettings({ className }: CalendarViewSettingsProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div className={className}>
          <Tooltip content='Calendar settings'>
            <Button variant='ghost' size='sm'>
              <Settings2 className='size-3' />
              <span className='hidden @lg/controls:block'>Settings</span>
            </Button>
          </Tooltip>
        </div>
      </PopoverTrigger>

      <PopoverContent className='w-[280px] p-0' align='start'>
        <CommandNavigation<SettingsNavigationItem>>
          <Command shouldFilter={false}>
            <CommandBreadcrumb rootLabel='Settings' />
            <CalendarViewSettingsContent />
          </Command>
        </CommandNavigation>
      </PopoverContent>
    </Popover>
  )
}
