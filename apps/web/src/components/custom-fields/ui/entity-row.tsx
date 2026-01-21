// apps/web/src/components/custom-fields/ui/entity-row.tsx
'use client'

import { TableCell, TableRow } from '@auxx/ui/components/table'
import { Badge } from '@auxx/ui/components/badge'
import { ChevronRight } from 'lucide-react'
import { EntityIcon, DEFAULT_COLOR } from '@auxx/ui/components/icons'

/** Props for EntityRow component */
interface EntityRowProps {
  label: string
  type: 'System' | 'Custom'
  /** Icon ID from icon-picker */
  iconId?: string | null
  /** Color ID from icon-picker */
  color?: string | null
  onClick: () => void
}

/** Row component for displaying system models and custom entities */
export function EntityRow({ label, type, iconId, color, onClick }: EntityRowProps) {
  const isCustom = type === 'Custom'

  return (
    <TableRow className="cursor-pointer hover:bg-muted/50 h-12" onClick={onClick}>
      <TableCell className="flex items-center space-x-2 ps-4 h-12">
        {/* Display EntityIcon for both system and custom entities */}
        <EntityIcon iconId={iconId || 'box'} color={color || DEFAULT_COLOR} className="size-6" />
        <span>{label}</span>
      </TableCell>
      <TableCell>
        <Badge variant={isCustom ? 'purple' : 'pill'} shape="tag">
          {type}
        </Badge>
      </TableCell>
      <TableCell>&nbsp;</TableCell>
      <TableCell className="text-right" data-clickable="true">
        <div className="justify-end flex items-center w-full h-full pe-3">
          <ChevronRight className="size-4" />
        </div>
      </TableCell>
    </TableRow>
  )
}
