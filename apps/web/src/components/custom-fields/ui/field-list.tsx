// apps/web/src/components/custom-fields/ui/field-list.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import type { ResourceField } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import { TableCell, TableRow } from '@auxx/ui/components/table'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Copy, FilePen, GripVertical, MoreHorizontal, Settings, Trash2 } from 'lucide-react'

/** Props for CustomFieldRow component */
interface CustomFieldRowProps {
  field: ResourceField
  onDelete: (id: string, fieldName?: string) => Promise<void>
  onEdit: (field: ResourceField) => void
  isPending: boolean
}

/**
 * CustomFieldRow component - displays a single custom field in a sortable table row
 * Clicking Edit opens the CustomFieldDialog for editing
 */
export function CustomFieldRow({
  field,
  onDelete,
  onEdit,
  isPending = false,
}: CustomFieldRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.8 : 1,
  }

  // Copy hook for field ID
  const { copy } = useCopy({ toastMessage: 'Field ID copied to clipboard' })

  // Get field type info for display
  const fieldTypeOption = fieldTypeOptions[field.fieldType as FieldType]
  const fieldTypeLabel = fieldTypeOption?.label ?? field.fieldType
  const iconId = fieldTypeOption?.iconId ?? 'circle'

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(isDragging ? 'bg-accent' : '', 'transition-colors')}>
      <TableCell className='w-[40px] py-1'>
        <div {...attributes} {...listeners} className='cursor-grab'>
          <GripVertical className='size-4 text-muted-foreground' />
        </div>
      </TableCell>
      <TableCell className='py-1'>
        <div className='text-sm'>
          {field.name ?? field.label}
          {field.required && <span className='ml-2 text-orange-500 text-xs'>Required</span>}
          {field.isUnique && <span className='ml-2 text-purple-500 text-xs'>Unique</span>}
        </div>
        {field.defaultValue && (
          <div className='text-xs text-muted-foreground'>Default: {field.defaultValue}</div>
        )}
      </TableCell>
      <TableCell className='py-1'>
        <div className='flex flex-row items-center gap-2 text-sm'>
          <EntityIcon iconId={iconId} variant='default' size='default' />
          <div className='text-foreground/50'>{fieldTypeLabel}</div>
        </div>
      </TableCell>
      <TableCell className='max-w-[300px] text-foreground/50 text-sm py-1'>
        {field.description ? (
          <div className='truncate' title={field.description}>
            {field.description}
          </div>
        ) : (
          <span>—</span>
        )}
      </TableCell>
      <TableCell className='py-1'>
        {field.isSystem && (
          <Badge variant='secondary' className='gap-1'>
            <Settings className='size-3' />
            System
          </Badge>
        )}
      </TableCell>
      <TableCell className='text-right py-1 w-[30px]'>
        <div className='flex justify-end gap-2'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon-sm'>
                <span className='sr-only'>Open menu</span>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => copy(field.id)}>
                <Copy />
                Copy Id
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => copy(field.name ?? field.label)}>
                <Copy />
                Copy Name
              </DropdownMenuItem>
              {field.capabilities.configurable && (
                <>
                  <DropdownMenuItem onClick={() => onEdit(field)} disabled={isPending}>
                    <FilePen />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant='destructive'
                    disabled={isPending}
                    onClick={() => onDelete(field.id, field.name ?? field.label)}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}
