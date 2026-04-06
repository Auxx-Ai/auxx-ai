// apps/web/src/components/editor/inline-picker/nodes/prompt-node-view.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { Settings } from 'lucide-react'
import { usePromptTemplate } from '~/components/kopilot/hooks/use-prompt-templates'
import type { InlineNodeBadgeProps } from '../types'

interface PromptTemplateBadgeProps extends InlineNodeBadgeProps {
  onEdit?: (id: string) => void
}

/**
 * Badge renderer for prompt template inline nodes.
 * Looks up the template name from the cached list and renders a compact badge.
 * Shows a cog icon on hover that opens the edit dialog.
 */
export function PromptTemplateBadge({ id, selected, onEdit }: PromptTemplateBadgeProps) {
  const template = usePromptTemplate(id)

  return (
    <Badge
      variant='pill'
      className={cn(
        'group/badge relative inline-flex items-center gap-1 px-1.5 py-0 text-xs cursor-pointer overflow-hidden',
        selected && 'ring-2 ring-primary ring-offset-1'
      )}>
      {template?.icon && (
        <span
          className='size-2 rounded-full shrink-0'
          style={{ backgroundColor: template.icon.color }}
        />
      )}
      <span className='truncate max-w-[150px]'>{template?.name ?? 'Unknown prompt'}</span>
      {onEdit && (
        <button
          type='button'
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onEdit(id)
          }}
          className={cn(
            'absolute inset-y-0 right-0 flex items-center pl-3 pr-1',
            'bg-gradient-to-r from-transparent via-muted/80 to-muted',
            'translate-x-full group-hover/badge:translate-x-0',
            'transition-transform duration-200 ease-out',
            'text-muted-foreground hover:text-foreground'
          )}>
          <Settings className='size-3' />
        </button>
      )}
    </Badge>
  )
}
