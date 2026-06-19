// apps/web/src/components/data-connectors/ui/source-path-badge.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Hash, X } from 'lucide-react'
import { recordBadgeVariants } from '~/components/resources/ui'
import { lastSegment } from '../hooks/use-source-paths'

interface SourcePathBadgeProps {
  /** The source-schema path token, e.g. `customer.email`. */
  path: string
  selected?: boolean
  /** When set, renders a trailing X button. */
  onRemove?: () => void
}

/**
 * Presentational chip for a source-path `{token}` inside the connector calc
 * editor. Unlike {@link FieldBadge}, it resolves nothing — the path IS the
 * label. Shares {@link recordBadgeVariants} so it sits visually next to field
 * chips. Shows the last path segment, with the full path on hover.
 */
export function SourcePathBadge({ path, selected, onRemove }: SourcePathBadgeProps) {
  return (
    <span
      data-slot='field-badge'
      title={path}
      className={cn(
        recordBadgeVariants({}),
        'font-mono font-normal',
        selected && 'ring-2 ring-primary ring-offset-1'
      )}>
      <Hash className='size-3 text-muted-foreground' />
      <span className='truncate'>{lastSegment(path)}</span>
      {onRemove && (
        <button
          type='button'
          data-slot='record-remove'
          aria-label='Remove'
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRemove()
          }}>
          <X />
        </button>
      )}
    </span>
  )
}
