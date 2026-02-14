// apps/web/src/components/dynamic-table/components/table-toolbar/kanban-view-settings.tsx
'use client'

import { getColorSwatch } from '@auxx/lib/custom-fields/client'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandBreadcrumb,
  CommandCheckboxItem,
  CommandDescription,
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
import { cn } from '@auxx/ui/lib/utils'
import { Columns3, LayoutGrid, Plus, Settings2, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useTableConfig } from '../../context/table-config-context'
import { useViewMetadata } from '../../context/view-metadata-context'
import { useUpdateKanbanConfig } from '../../stores/store-actions'
import { useKanbanConfig } from '../../stores/store-selectors'

/** Navigation item type for KanbanViewSettings */
interface SettingsNavigationItem extends NavigationItem {
  id: string
  label: string
  type: 'pipeline' | 'columns' | 'add-field'
}

/** Props for KanbanViewSettings */
interface KanbanViewSettingsProps {
  className?: string
}

/**
 * Root stack component - main menu with settings and card fields
 * Migrated to use split contexts and stores
 */
function RootStack() {
  const { push } = useCommandNavigation<SettingsNavigationItem>()
  const { tableId } = useTableConfig()
  const { customFields, selectFields } = useViewMetadata()

  // Get kanban config from centralized selectors/actions
  const kanbanConfig = useKanbanConfig(tableId)
  const updateKanbanConfig = useUpdateKanbanConfig(tableId)

  const cardFields = kanbanConfig?.cardFields ?? []

  /** Get grouped by field name for display */
  const groupByField = useMemo(() => {
    return selectFields?.find((f) => f.id === kanbanConfig?.groupByFieldId)
  }, [selectFields, kanbanConfig?.groupByFieldId])

  /** Navigate to a sub-stack */
  const handleNavigate = useCallback(
    (type: 'pipeline' | 'columns' | 'add-field', label: string) => {
      push({ id: type, label, type })
    },
    [push]
  )

  /** Handle card fields reorder (optimistic via store) */
  const handleCardFieldsReorder = useCallback(
    (newOrder: string[]) => {
      updateKanbanConfig({ cardFields: newOrder })
    },
    [updateKanbanConfig]
  )

  /** Handle removing a card field (optimistic via store) */
  const handleRemoveCardField = useCallback(
    (fieldId: string) => {
      updateKanbanConfig({
        cardFields: cardFields.filter((id) => id !== fieldId),
      })
    },
    [cardFields, updateKanbanConfig]
  )

  return (
    <CommandList>
      {/* View Settings Group */}
      <CommandGroup heading='View Settings'>
        <CommandNavigableItem
          item={{ id: 'pipeline', label: 'Grouped by pipeline', type: 'pipeline' }}
          hasChildren
          onSelect={() => handleNavigate('pipeline', 'Grouped by pipeline')}>
          <LayoutGrid />
          <span className='flex-1'>Grouped by pipeline</span>
          <span className='text-xs text-muted-foreground truncate max-w-24'>
            {groupByField?.name ?? 'Not set'}
          </span>
        </CommandNavigableItem>

        <CommandNavigableItem
          item={{ id: 'columns', label: 'Visible columns', type: 'columns' }}
          hasChildren
          onSelect={() => handleNavigate('columns', 'Visible columns')}>
          <Columns3 />
          <span>Visible columns</span>
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

/**
 * Pipeline selection stack - select which field to group by
 * Migrated to use split contexts and stores
 */
function PipelineSelectionStack() {
  const { tableId } = useTableConfig()
  const { selectFields } = useViewMetadata()

  // Get current view and kanban config from centralized selectors/actions
  const kanbanConfig = useKanbanConfig(tableId)
  const updateKanbanConfig = useUpdateKanbanConfig(tableId)

  /** Handle selecting a field */
  const handleSelectField = useCallback(
    (fieldId: string) => {
      // Reset column order when changing field
      updateKanbanConfig({
        groupByFieldId: fieldId,
        columnOrder: [],
        columnSettings: {},
      })
    },
    [updateKanbanConfig]
  )

  return (
    <CommandList>
      <CommandDescription>Select which field to group cards by.</CommandDescription>
      <CommandSeparator />
      <CommandRadioGroup value={kanbanConfig?.groupByFieldId} onValueChange={handleSelectField}>
        {(selectFields ?? []).map((field) => (
          <CommandRadioItem key={field.id} value={field.id}>
            {field.name}
          </CommandRadioItem>
        ))}
      </CommandRadioGroup>

      {selectFields && selectFields.length > 0 && <CommandSeparator />}

      <CommandGroup>
        <CommandItem>
          <Plus />
          Create new field
        </CommandItem>
      </CommandGroup>
    </CommandList>
  )
}

/**
 * Visible columns stack - toggle column visibility
 * Migrated to use split contexts and stores
 */
function VisibleColumnsStack() {
  const { tableId } = useTableConfig()
  const { selectFields } = useViewMetadata()

  // Get kanban config from centralized selectors/actions
  const kanbanConfig = useKanbanConfig(tableId)
  const updateKanbanConfig = useUpdateKanbanConfig(tableId)

  /** Get the groupBy field and its options (stages) */
  const groupByField = useMemo(() => {
    return selectFields?.find((f) => f.id === kanbanConfig?.groupByFieldId)
  }, [selectFields, kanbanConfig?.groupByFieldId])

  const stages = groupByField?.options?.options ?? []
  const columnSettings = kanbanConfig?.columnSettings ?? {}

  /** Handle toggling a column's visibility */
  const handleToggleColumn = useCallback(
    (columnId: string, isVisible: boolean) => {
      updateKanbanConfig({
        columnSettings: {
          ...columnSettings,
          [columnId]: { ...columnSettings[columnId], isVisible },
        },
      })
    },
    [columnSettings, updateKanbanConfig]
  )

  if (!groupByField) {
    return (
      <CommandList>
        <CommandEmpty>Select a pipeline field first</CommandEmpty>
      </CommandList>
    )
  }

  return (
    <CommandList>
      <CommandDescription>Toggle visibility of kanban columns.</CommandDescription>
      <CommandSeparator />
      <CommandGroup>
        {stages.map((stage) => {
          const isVisible = columnSettings[stage.value]?.isVisible !== false
          return (
            <CommandCheckboxItem
              key={stage.value}
              value={stage.value}
              checked={isVisible}
              onCheckedChange={(checked) => handleToggleColumn(stage.value, checked)}
              variant='switch'>
              <div className='flex items-center gap-2'>
                {stage.color && (
                  <div className={cn('size-3 rounded-full', getColorSwatch(stage.color))} />
                )}
                <span>{stage.label}</span>
              </div>
            </CommandCheckboxItem>
          )
        })}
      </CommandGroup>

      {stages.length === 0 && <CommandEmpty>No stages configured for this field</CommandEmpty>}
    </CommandList>
  )
}

/**
 * Add card field stack - search and add fields to cards
 * Migrated to use split contexts and stores
 */
function AddCardFieldStack() {
  const { tableId } = useTableConfig()
  const { customFields } = useViewMetadata()

  // Get kanban config from centralized selectors/actions
  const kanbanConfig = useKanbanConfig(tableId)
  const updateKanbanConfig = useUpdateKanbanConfig(tableId)
  const [search, setSearch] = useState('')

  const cardFields = kanbanConfig?.cardFields ?? []

  /** Fields available to add (not already in cardFields) */
  const availableFields = useMemo(() => {
    const currentFieldIds = new Set(cardFields)
    return (customFields ?? []).filter((f) => !currentFieldIds.has(f.id))
  }, [customFields, cardFields])

  /** Filtered fields based on search */
  const filteredFields = useMemo(() => {
    if (!search) return availableFields
    const query = search.toLowerCase()
    return availableFields.filter((f) => f.name.toLowerCase().includes(query))
  }, [availableFields, search])

  /** Handle adding a field */
  const handleAddField = useCallback(
    (fieldId: string) => {
      updateKanbanConfig({
        cardFields: [...cardFields, fieldId],
      })
    },
    [cardFields, updateKanbanConfig]
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
function KanbanViewSettingsContent() {
  const { current } = useCommandNavigation<SettingsNavigationItem>()

  // Render based on current navigation level
  if (current?.type === 'pipeline') {
    return <PipelineSelectionStack />
  }
  if (current?.type === 'columns') {
    return <VisibleColumnsStack />
  }
  if (current?.type === 'add-field') {
    return <AddCardFieldStack />
  }

  // Root stack
  return <RootStack />
}

/**
 * KanbanViewSettings component
 * Manages kanban-specific view settings like pipeline selection, column visibility, and card fields
 *
 * Migrated to use split contexts and stores instead of monolithic TableContext
 */
export function KanbanViewSettings({ className }: KanbanViewSettingsProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div className={className}>
          <Tooltip content='Kanban settings'>
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
            <KanbanViewSettingsContent />
          </Command>
        </CommandNavigation>
      </PopoverContent>
    </Popover>
  )
}
