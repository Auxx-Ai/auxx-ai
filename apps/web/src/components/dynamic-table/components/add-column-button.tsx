// apps/web/src/components/dynamic-table/components/add-column-button.tsx

'use client'

import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { Command, CommandBreadcrumb, CommandNavigation } from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { Tooltip } from '~/components/global/tooltip'
import { useTableConfig } from '../context/table-config-context'
import { useSetColumnOrder, useSetColumnVisibility } from '../stores/store-actions'
import { useColumnOrder, useColumnVisibility } from '../stores/store-selectors'
import { AddColumnStack, type ColumnNavigationItem } from './table-toolbar/add-column-stack'

/**
 * Built-in "+" button rendered at the end of the dynamic-table header row.
 * Opens a popover with the same field picker the toolbar Columns → Add column
 * flow uses, but lands the user directly on the picker without the extra click.
 *
 * Only rendered when the table has an entityDefinitionId — non-resource tables
 * fall back to the LegacyAddColumnStack via AddColumnStack's internal branch.
 */
export function AddColumnButton() {
  const [isOpen, setIsOpen] = useState(false)
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false)
  const { tableId, entityDefinitionId } = useTableConfig()
  const columnVisibility = useColumnVisibility(tableId)
  const columnOrder = useColumnOrder(tableId)
  const setColumnVisibility = useSetColumnVisibility(tableId)
  const setColumnOrder = useSetColumnOrder(tableId)

  const handleCreateFieldClick = useCallback(() => {
    setIsOpen(false)
    setIsFieldDialogOpen(true)
  }, [])

  const handleFieldAdded = useCallback(() => {
    setIsOpen(false)
  }, [])

  return (
    <>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <div className='flex items-center h-8'>
            <Tooltip content='Add column'>
              <Button variant='ghost' size='icon-xs' className='rounded-sm'>
                <Plus />
              </Button>
            </Tooltip>
          </div>
        </PopoverTrigger>

        <PopoverContent className='w-[280px] p-0' align='end'>
          <CommandNavigation<ColumnNavigationItem>>
            <Command shouldFilter={false}>
              <CommandBreadcrumb rootLabel='Add column' />
              <AddColumnStack
                onCreateField={handleCreateFieldClick}
                onFieldAdded={handleFieldAdded}
              />
            </Command>
          </CommandNavigation>
        </PopoverContent>
      </Popover>

      {isFieldDialogOpen && entityDefinitionId && (
        <CustomFieldDialog
          open={isFieldDialogOpen}
          onOpenChange={setIsFieldDialogOpen}
          entityDefinitionId={entityDefinitionId}
          onSuccess={(field) => {
            // Auto-add new field to visible columns
            const fieldColumnId = toResourceFieldId(entityDefinitionId, toFieldId(field.id))
            setColumnVisibility({
              ...(columnVisibility ?? {}),
              [fieldColumnId]: true,
            })
            if (!columnOrder?.includes(fieldColumnId)) {
              setColumnOrder([...(columnOrder ?? []), fieldColumnId])
            }
          }}
        />
      )}
    </>
  )
}
