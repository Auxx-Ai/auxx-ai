// apps/web/src/components/dynamic-table/components/table-toolbar/table-sort-builder.tsx

'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import type { SortingState } from '@tanstack/react-table'
import { ArrowDown, ArrowDownUp, ArrowUp, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { type FieldDefinition, ResourceFieldSelector } from '~/components/conditions'
import { Tooltip } from '~/components/global/tooltip'
import { getSortOptionsForFieldType } from '../../utils/constants'

interface TableSortBuilderProps {
  /** Current sorting from the view/session config. */
  sorting: SortingState
  onSortingChange: (sorting: SortingState) => void
  /** The resource's sortable fields, before this component's own eligibility pass. */
  sortableFields: ResourceField[]
  /** entityDefinitionId — used to build the ResourceFieldId a sort is keyed by. */
  resourceType: string
  disabled?: boolean
}

/**
 * The toolbar's Sort control.
 *
 * Exists because the column header was the ONLY way to sort — `header-cell.tsx`
 * holds the sole `toggleSorting` call site — which coupled sorting to column
 * visibility in two bad ways: you could not sort by a field without also
 * putting it on screen as a column, and a sort whose column you later hid kept
 * applying server-side with no way to see or clear it.
 *
 * Single sort by design. The whole stack carries `sorting` as an array, but both
 * query lanes read `sorting[0]` and drop the rest, so offering more here would
 * only make an existing silent truncation visible.
 *
 * Applies IMMEDIATELY, unlike the sibling filter popover's buffered draft —
 * the column header applies instantly, and two sort entry points that commit at
 * different moments would be worse than either behaviour on its own.
 */
export function TableSortBuilder({
  sorting,
  onSortingChange,
  sortableFields,
  resourceType,
  disabled = false,
}: TableSortBuilderProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Only offer what the server will actually apply. `buildOrderBySql` returns
  // `undefined` for a non-sortable or hidden field, and the list then falls back
  // to its default order — so an ineligible option here would look like it did
  // nothing. Mirrors the column factory's `enableSorting` plus the `hidden`
  // rule, which the shared `sortableFields` selector does not apply.
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

  /** A sort is keyed by the column id, which is always a ResourceFieldId. */
  const fieldSortId = useCallback(
    (field: ResourceField): string =>
      field.resourceFieldId ?? toResourceFieldId(resourceType, toFieldId(field.id as string)),
    [resourceType]
  )

  const fieldDefinitions: FieldDefinition[] = useMemo(
    () =>
      eligibleFields.map((field) => ({
        id: fieldSortId(field),
        label: field.label,
        type: field.type,
        fieldType: field.fieldType,
        fieldKey: field.key,
      })),
    [eligibleFields, fieldSortId]
  )

  const active = sorting[0]
  const activeField = active
    ? eligibleFields.find((field) => fieldSortId(field) === active.id)
    : undefined

  // A sort naming a field that is gone, hidden, or no longer sortable. It is
  // still being sent, and the list silently falls back to its default order —
  // so say so and offer the way out rather than rendering a blank picker.
  const isOrphanedSort = !!active && !activeField

  const directionOptions = getSortOptionsForFieldType(activeField?.fieldType)

  const TriggerIcon = activeField ? (active!.desc ? ArrowDown : ArrowUp) : ArrowDownUp

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

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div>
          <Tooltip content={activeField ? `Sorted by ${activeField.label}` : 'Sort rows'}>
            <Button variant='ghost' size='sm' disabled={disabled}>
              {/* The label stays 'Sort' at every width — a field name in the
                  toolbar gets long fast. The active sort shows as the direction
                  arrow (zero extra width) with the field named in the tooltip;
                  without some indicator, a sort set here and then left behind is
                  exactly the invisible state this control exists to end. */}
              <TriggerIcon />
              <span className='hidden @lg/controls:block'>Sort</span>
            </Button>
          </Tooltip>
        </div>
      </PopoverTrigger>

      <PopoverContent className='w-[260px] p-2' align='start'>
        <div className='space-y-2'>
          {isOrphanedSort && (
            <div className='flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground'>
              <TriangleAlert className='mt-0.5 size-3.5 shrink-0' />
              <span>
                This view sorts by a field that is no longer available, so it is not being applied.
              </span>
            </div>
          )}

          <div className='px-1'>
            <ResourceFieldSelector
              value={activeField ? active!.id : ''}
              onChange={handleFieldChange}
              availableFields={fieldDefinitions}
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
