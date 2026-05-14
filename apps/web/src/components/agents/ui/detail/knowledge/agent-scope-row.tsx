// apps/web/src/components/agents/ui/detail/knowledge/agent-scope-row.tsx
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
import {
  ChevronRight,
  FileText,
  FolderClosed,
  FolderOpen,
  MoreVertical,
  Pin,
  Star,
} from 'lucide-react'
import type { EffectiveScopeMode } from './derive-scope-mode'

export interface AgentScopeRowProps {
  recordId: string
  title: string
  kind: 'container' | 'leaf'
  depth: number
  effectiveMode: EffectiveScopeMode
  isPinned: boolean
  pinReason: 'manual' | 'mention' | null
  isOpen?: boolean
  isLoading?: boolean
  onToggleOpen?: () => void
  onSetMode: (mode: EffectiveScopeMode) => void
  onTogglePin: () => void
}

const MODE_LABELS_CONTAINER: Record<EffectiveScopeMode, string> = {
  include_descendants: 'Whole',
  include_one: 'Container only',
  exclude: 'Excluded',
  none: 'None',
}

const MODE_LABELS_LEAF: Record<EffectiveScopeMode, string> = {
  include_descendants: 'Included',
  include_one: 'Included',
  exclude: 'Excluded',
  none: 'None',
}

/**
 * Lightweight `ArticleSidebarItem`-flavored row: icon + title + mode label +
 * pin star + expand chevron + actions menu. All interactive bits are
 * controlled — parent owns expand state and mutations.
 */
export function AgentScopeRow({
  recordId,
  title,
  kind,
  depth,
  effectiveMode,
  isPinned,
  pinReason,
  isOpen,
  isLoading,
  onToggleOpen,
  onSetMode,
  onTogglePin,
}: AgentScopeRowProps) {
  const paddingLeftRem = 0.5 + depth * 1.125
  const isContainer = kind === 'container'
  const modeLabel = isContainer
    ? MODE_LABELS_CONTAINER[effectiveMode]
    : MODE_LABELS_LEAF[effectiveMode]

  const isMentionPin = pinReason === 'mention'

  return (
    <div className='relative' style={{ paddingLeft: `${paddingLeftRem}rem` }}>
      <div
        className={cn(
          'group/scope-row flex items-center rounded-md text-sm',
          'text-muted-foreground hover:bg-background',
          effectiveMode === 'exclude' && 'opacity-60'
        )}>
        <span className='flex items-center px-1 size-7 text-muted-foreground'>
          {isContainer ? (
            isOpen ? (
              <FolderOpen className='size-4' />
            ) : (
              <FolderClosed className='size-4' />
            )
          ) : (
            <FileText className='size-4' />
          )}
        </span>

        <span className='flex-1 truncate px-1 py-1.5 text-foreground'>
          {title || (isLoading ? '…' : 'Untitled')}
        </span>

        <span className='text-xs text-muted-foreground/70 mr-1'>{modeLabel}</span>

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
                <Star className='size-4 opacity-40 group-hover/scope-row:opacity-100' />
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

        {isContainer && (
          <button
            type='button'
            onClick={onToggleOpen}
            className='p-1 rounded-md hover:bg-primary/5'
            aria-label={isOpen ? 'Collapse' : 'Expand'}>
            <ChevronRight
              className={cn(
                'size-3.5 text-muted-foreground transition-transform',
                isOpen && 'rotate-90'
              )}
            />
          </button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='size-7 opacity-0 group-hover/scope-row:opacity-100 data-[state=open]:opacity-100'>
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
      </div>
      <span className='sr-only'>{recordId}</span>
    </div>
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
