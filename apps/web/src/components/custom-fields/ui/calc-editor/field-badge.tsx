// apps/web/src/components/custom-fields/ui/calc-editor/field-badge.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'

/** Props for FieldBadge component */
interface FieldBadgeProps {
  id: string
  selected: boolean
  availableFields: Array<{ key: string; label: string; type: string }>
}

/**
 * Badge component for field nodes in the calc editor.
 * Shows field label or warning if field doesn't exist.
 */
export function FieldBadge({ id, selected, availableFields }: FieldBadgeProps) {
  const field = availableFields.find((f) => f.key === id)

  if (!field) {
    return (
      <Badge
        variant="destructive"
        className={cn('gap-1 text-xs font-normal', selected && 'ring-2 ring-primary ring-offset-1')}
      >
        <AlertTriangle className="h-3 w-3" />
        {id}
      </Badge>
    )
  }

  return (
    <Badge
      variant="secondary"
      className={cn('text-xs font-normal', selected && 'ring-2 ring-primary ring-offset-1')}
    >
      {field.label}
    </Badge>
  )
}
