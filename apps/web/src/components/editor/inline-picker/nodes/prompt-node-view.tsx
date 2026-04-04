// apps/web/src/components/editor/inline-picker/nodes/prompt-node-view.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { usePromptTemplate } from '~/components/kopilot/hooks/use-prompt-templates'
import type { InlineNodeBadgeProps } from '../types'

/**
 * Badge renderer for prompt template inline nodes.
 * Looks up the template name from the cached list and renders a compact badge.
 */
export function PromptTemplateBadge({ id, selected }: InlineNodeBadgeProps) {
  const template = usePromptTemplate(id)

  return (
    <Badge
      variant='pill'
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0 text-xs cursor-pointer',
        selected && 'ring-2 ring-primary ring-offset-1'
      )}>
      {template?.icon && (
        <span
          className='size-2 rounded-full shrink-0'
          style={{ backgroundColor: template.icon.color }}
        />
      )}
      <span className='truncate max-w-[150px]'>{template?.name ?? 'Unknown prompt'}</span>
    </Badge>
  )
}
