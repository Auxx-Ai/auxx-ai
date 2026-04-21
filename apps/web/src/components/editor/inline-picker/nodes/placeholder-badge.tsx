// apps/web/src/components/editor/inline-picker/nodes/placeholder-badge.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Braces } from 'lucide-react'
import { usePlaceholderLabel } from '~/components/editor/placeholders/catalog'
import type { InlineNodeBadgeProps } from '../types'

/**
 * Badge renderer for placeholder inline nodes.
 * Reads the human breadcrumb from the resource store via `usePlaceholderLabel`.
 * Unresolvable tokens render in the destructive variant with a warning icon
 * (same UX as calc's FieldBadge for missing fields).
 */
export function PlaceholderBadge({ id, selected }: InlineNodeBadgeProps) {
  const { breadcrumb, resolved } = usePlaceholderLabel(id)

  return (
    <Badge
      variant={resolved ? 'pill' : 'destructive'}
      className={cn(
        'group/badge relative inline-flex items-center gap-1 px-1.5 py-0 text-xs cursor-pointer align-baseline',
        selected && 'ring-2 ring-primary ring-offset-1'
      )}
      title={id}>
      {resolved ? (
        <Braces className='size-3 shrink-0 text-muted-foreground' />
      ) : (
        <AlertTriangle className='size-3 shrink-0' />
      )}
      <span className='truncate max-w-[200px]'>{breadcrumb}</span>
    </Badge>
  )
}
