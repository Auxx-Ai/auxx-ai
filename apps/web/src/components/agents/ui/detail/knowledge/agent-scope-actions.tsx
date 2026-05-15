// apps/web/src/components/agents/ui/detail/knowledge/agent-scope-actions.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { MoreVertical, Pin, Star } from 'lucide-react'
import type { EffectiveScopeMode } from './derive-scope-mode'

export interface AgentScopeActionsProps {
  kind: 'container' | 'leaf'
  effectiveMode: EffectiveScopeMode
  isPinned: boolean
  pinReason: 'manual' | 'mention' | null
  onSetMode: (mode: EffectiveScopeMode) => void
  onTogglePin: () => void
}

const MODE_LABELS_CONTAINER: Record<EffectiveScopeMode, string> = {
  include_descendants: 'Whole',
  include_one: 'Container only',
  exclude: 'Excluded',
  none: '',
}

const MODE_LABELS_LEAF: Record<EffectiveScopeMode, string> = {
  include_descendants: 'Included',
  include_one: 'Included',
  exclude: 'Excluded',
  none: '',
}

/**
 * Trailing-slot cluster for an agent scope row: effective-mode label, pin
 * star, and the mode dropdown. Slots into `TreeRow`'s `actions` prop.
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
  const modeLabel = isContainer
    ? MODE_LABELS_CONTAINER[effectiveMode]
    : MODE_LABELS_LEAF[effectiveMode]

  return (
    <>
      {modeLabel && <span className='text-xs text-muted-foreground/70'>{modeLabel}</span>}

      <Tooltip>
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <TooltipContent side='left'>
          {isMentionPin
            ? 'Pinned by mention in instructions'
            : isPinned
              ? 'Unpin from agent'
              : 'Pin to agent'}
        </TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='size-7 opacity-0 group-hover/tree-row:opacity-100 data-[state=open]:opacity-100'>
            <MoreVertical className='size-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-48'>
          <DropdownMenuLabel>Access</DropdownMenuLabel>
          {isContainer ? (
            <>
              <ModeItem
                current={effectiveMode}
                value='include_descendants'
                label='Whole'
                onSelect={() => onSetMode('include_descendants')}
              />
              <ModeItem
                current={effectiveMode}
                value='include_one'
                label='Container only'
                onSelect={() => onSetMode('include_one')}
              />
              <ModeItem
                current={effectiveMode}
                value='exclude'
                label='Exclude'
                onSelect={() => onSetMode('exclude')}
              />
              <DropdownMenuSeparator />
              <ModeItem
                current={effectiveMode}
                value='none'
                label='None'
                onSelect={() => onSetMode('none')}
              />
            </>
          ) : (
            <>
              <ModeItem
                current={effectiveMode}
                value='include_one'
                label='Include'
                onSelect={() => onSetMode('include_one')}
              />
              <ModeItem
                current={effectiveMode}
                value='exclude'
                label='Exclude'
                onSelect={() => onSetMode('exclude')}
              />
              <DropdownMenuSeparator />
              <ModeItem
                current={effectiveMode}
                value='none'
                label='None'
                onSelect={() => onSetMode('none')}
              />
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

interface ModeItemProps {
  current: EffectiveScopeMode
  value: EffectiveScopeMode
  label: string
  onSelect: () => void
}

function ModeItem({ current, value, label, onSelect }: ModeItemProps) {
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault()
        onSelect()
      }}
      className={cn(current === value && 'bg-accent')}>
      {label}
      {current === value && <span className='ml-auto text-xs'>✓</span>}
    </DropdownMenuItem>
  )
}
