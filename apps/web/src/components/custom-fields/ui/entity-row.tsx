// apps/web/src/components/custom-fields/ui/entity-row.tsx
'use client'

import { TableCell, TableRow } from '@auxx/ui/components/table'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { MoreHorizontal, ChevronRight, FilePen, Archive, ArchiveRestore, Plus } from 'lucide-react'
import { EntityIcon, DEFAULT_COLOR } from '@auxx/ui/components/icons'

/** Props for EntityRow component */
interface EntityRowProps {
  label: string
  type: 'System' | 'Custom'
  /** Icon ID from icon-picker */
  iconId?: string | null
  /** Color ID from icon-picker */
  color?: string | null
  isArchived?: boolean
  onClick: () => void
  onEdit?: () => void
  onArchive?: () => void
  onRestore?: () => void
  onNewItem?: () => void
}

/** Row component for displaying system models and custom entities */
export function EntityRow({
  label,
  type,
  iconId,
  color,
  isArchived = false,
  onClick,
  onEdit,
  onArchive,
  onRestore,
  onNewItem,
}: EntityRowProps) {
  const isCustom = type === 'Custom'

  return (
    <TableRow className="cursor-pointer hover:bg-muted/50 h-12" onClick={onClick}>
      <TableCell className="flex items-center space-x-2 ps-4 h-12">
        {/* Display EntityIcon for both system and custom entities */}
        <EntityIcon
          iconId={iconId || 'box'}
          color={isCustom ? color || DEFAULT_COLOR : DEFAULT_COLOR}
          className="size-6"
        />
        <span className={isArchived ? 'text-muted-foreground line-through' : ''}>{label}</span>
        {isArchived && (
          <Badge variant="outline" className="text-xs">
            Archived
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={isCustom ? 'purple' : 'pill'} shape="tag">
          {type}
        </Badge>
      </TableCell>
      <TableCell>&nbsp;</TableCell>
      <TableCell className="text-right" data-clickable="true">
        <div className="justify-end flex items-center w-full h-full pe-3">
          {isCustom ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon-sm">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onNewItem?.()
                  }}>
                  <Plus />
                  New Item
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onEdit?.()
                  }}>
                  <FilePen />
                  Edit
                </DropdownMenuItem>
                {isArchived ? (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      onRestore?.()
                    }}>
                    <ArchiveRestore />
                    Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      onArchive?.()
                    }}>
                    <Archive />
                    Archive
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <ChevronRight className="size-4" />
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
