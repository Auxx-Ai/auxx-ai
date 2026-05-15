// apps/web/src/components/agents/ui/detail/knowledge/agent-scope-actions.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Ban, Check, Pin, Star, Trash2 } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import type { EffectiveScopeMode } from './derive-scope-mode'

export interface AgentScopeActionsProps {
  kind: 'container' | 'leaf'
  effectiveMode: EffectiveScopeMode
  isPinned: boolean
  pinReason: 'manual' | 'mention' | null
  onSetMode: (mode: EffectiveScopeMode) => void
  onTogglePin: () => void
}

/**
 * Trailing-slot cluster for an agent scope row: include/exclude toggle, pin
 * star, and a trash button to clear the rule. Slots into `TreeRow`'s
 * `actions` prop.
 */
export function AgentScopeActions({
  kind,
  effectiveMode,
  isPinned,
  pinReason,
  onSetMode,
  onTogglePin,
}: AgentScopeActionsProps) {
  const isContainer = kind === 'container'
  const isMentionPin = pinReason === 'mention'
  const includeMode: EffectiveScopeMode = isContainer ? 'include_descendants' : 'include_one'
  const isExcluded = effectiveMode === 'exclude'
  const isIncluded = effectiveMode === 'include_descendants' || effectiveMode === 'include_one'

  return (
    <>
      <Tooltip
        side='left'
        content={
          isIncluded
            ? 'Included — click to exclude'
            : isExcluded
              ? 'Excluded — click to include'
              : 'Not set — click to include'
        }>
        <button
          type='button'
          onClick={() => onSetMode(isIncluded ? 'exclude' : includeMode)}
          className='p-1 rounded-md hover:bg-primary/5'
          aria-label={isIncluded ? 'Exclude' : 'Include'}>
          {isExcluded ? (
            <Ban className='size-4 text-destructive' />
          ) : isIncluded ? (
            <Check className='size-4 text-emerald-600' />
          ) : (
            <Check className='size-4 opacity-40 group-hover/tree-row:opacity-100' />
          )}
        </button>
      </Tooltip>

      <Tooltip
        side='left'
        content={
          isMentionPin
            ? 'Pinned by mention in instructions'
            : isPinned
              ? 'Unpin from agent'
              : 'Pin to agent'
        }>
        <button
          type='button'
          onClick={onTogglePin}
          disabled={isMentionPin}
          className={cn(
            'p-1 rounded-md hover:bg-primary/5 disabled:cursor-not-allowed',
            isMentionPin && 'opacity-100'
          )}
          aria-label={isPinned ? 'Unpin' : 'Pin'}>
          {isMentionPin ? (
            <Pin className='size-4 text-primary' />
          ) : isPinned ? (
            <Star className='size-4 text-amber-500 fill-amber-500' />
          ) : (
            <Star className='size-4 opacity-40 group-hover/tree-row:opacity-100' />
          )}
        </button>
      </Tooltip>

      <Tooltip side='left' content='Remove rule'>
        <button
          type='button'
          onClick={() => onSetMode('none')}
          className={cn(
            'p-1 rounded-md hover:bg-destructive/10 opacity-0 group-hover/tree-row:opacity-100',
            effectiveMode === 'none' && 'invisible pointer-events-none'
          )}
          aria-label='Remove rule'>
          <Trash2 className='size-4 text-muted-foreground hover:text-destructive' />
        </button>
      </Tooltip>
    </>
  )
}
