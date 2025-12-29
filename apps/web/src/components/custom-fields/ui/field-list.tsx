// apps/web/src/components/custom-fields/ui/field-list.tsx
'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TableCell, TableRow } from '@auxx/ui/components/table'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { GripVertical, MoreHorizontal, FilePen, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'

/** Props for CustomFieldRow component */
interface CustomFieldRowProps {
  field: any
  onDelete: (id: string, fieldName?: string) => Promise<void>
  onEdit: (field: any) => void
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

  // Get field type info for display
  const fieldType = fieldTypeOptions.find((opt) => opt.value === field.type)
  const fieldTypeLabel = fieldType ? fieldType.label : field.type
  const Icon = fieldType ? fieldType.icon : null

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(isDragging ? 'bg-accent' : '', 'transition-colors')}>
      <TableCell className="w-[40px] py-1">
        <div {...attributes} {...listeners} className="cursor-grab">
          <GripVertical className="size-4 text-muted-foreground" />
        </div>
      </TableCell>
      <TableCell className="py-1">
        <div className="text-sm">
          {field.name}
          {field.required && <span className="ml-2 text-orange-500 text-xs">Required</span>}
          {field.isUnique && <span className="ml-2 text-purple-500 text-xs">Unique</span>}
        </div>
        {field.defaultValue && (
          <div className="text-xs text-muted-foreground">Default: {field.defaultValue}</div>
        )}
      </TableCell>
      <TableCell className="py-1">
        <div className="flex flex-row items-center gap-2 text-sm">
          {Icon && <Icon className="size-4" />}
          <div className="text-foreground/50">{fieldTypeLabel}</div>
          {field.isCustom && <div className="text-xs text-muted-foreground">Custom Field</div>}
        </div>
      </TableCell>
      <TableCell className="max-w-[300px] text-foreground/50 text-sm py-1">
        {field.description ? (
          <div className="truncate" title={field.description}>
            {field.description}
          </div>
        ) : (
          <span>—</span>
        )}
      </TableCell>
      <TableCell className="text-right py-1">
        <div className="flex justify-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(field)} disabled={isPending}>
                <FilePen />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={isPending}
                onClick={() => onDelete(field.id, field.name)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}
