// apps/web/src/components/agents/ui/detail/knowledge/agent-scope-actions.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Ban, Check, Trash2 } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import type { EffectiveScopeMode } from './derive-scope-mode'

export interface AgentScopeActionsProps {
  kind: 'container' | 'leaf'
  effectiveMode: EffectiveScopeMode
  /** `true` when a `source='mention'` knowledge entry covers this record. */
  isMentionLocked: boolean
  onSetMode: (mode: EffectiveScopeMode) => void
}

/**
 * Trailing-slot cluster for an agent scope row: include/exclude toggle plus a
 * trash button to clear the rule. Slots into `TreeRow`'s `actions` prop.
 *
 * When `effectiveMode` is an `inherited_*` variant the row has no explicit
 * stored rule of its own — the include/exclude icon renders without color to
 * signal that, the trash button hides (nothing to remove), and clicking the
 * toggle writes a *new* explicit row that overrides the inherited state.
 *
 * When `isMentionLocked` is true the row is referenced by an @-mention in the
 * agent's prompt — the toggle disables and the trash hides; the user must
 * remove the mention in the prompt instead.
 */
export function AgentScopeActions({
  kind,
  effectiveMode,
  isMentionLocked,
  onSetMode,
}: AgentScopeActionsProps) {
  const isContainer = kind === 'container'
  const includeMode: EffectiveScopeMode = isContainer ? 'include_descendants' : 'include_one'

  const isExplicitExcluded = effectiveMode === 'exclude'
  const isExplicitIncluded =
    effectiveMode === 'include_descendants' || effectiveMode === 'include_one'
  const isInheritedIncluded = effectiveMode === 'inherited_include_descendants'
  const isInheritedExcluded = effectiveMode === 'inherited_exclude'

  const isExcluded = isExplicitExcluded || isInheritedExcluded
  const isIncluded = isExplicitIncluded || isInheritedIncluded
  const isInherited = isInheritedIncluded || isInheritedExcluded
  const hasExplicitRule = isExplicitExcluded || isExplicitIncluded

  const tooltipContent = isMentionLocked
    ? 'Included by mention in instructions. Remove the @-mention to change.'
    : isInheritedIncluded
      ? 'Included (inherited) — click to exclude'
      : isInheritedExcluded
        ? 'Excluded (inherited) — click to include'
        : isExplicitIncluded
          ? 'Included — click to exclude'
          : isExplicitExcluded
            ? 'Excluded — click to include'
            : 'Not set — click to include'

  return (
    <>
      <Tooltip side='left' content={tooltipContent}>
        <button
          type='button'
          onClick={() => {
            if (isMentionLocked) return
            onSetMode(isIncluded ? 'exclude' : includeMode)
          }}
          disabled={isMentionLocked}
          className={cn(
            'p-1 rounded-md hover:bg-primary/5 disabled:cursor-not-allowed disabled:hover:bg-transparent',
            isMentionLocked && 'opacity-70'
          )}
          aria-label={isIncluded ? 'Exclude' : 'Include'}>
          {isExcluded ? (
            <Ban
              className={cn(
                'size-4',
                hasExplicitRule
                  ? 'text-destructive'
                  : 'text-muted-foreground opacity-40 group-hover/tree-row:opacity-100'
              )}
            />
          ) : isIncluded ? (
            <Check
              className={cn(
                'size-4',
                hasExplicitRule
                  ? 'text-emerald-600'
                  : 'text-muted-foreground opacity-40 group-hover/tree-row:opacity-100'
              )}
            />
          ) : (
            <Check className='size-4 opacity-40 group-hover/tree-row:opacity-100' />
          )}
        </button>
      </Tooltip>

      {!isMentionLocked && (
        <Tooltip side='left' content={isInherited ? 'Reset to inherited' : 'Remove rule'}>
          <button
            type='button'
            onClick={() => onSetMode('none')}
            className={cn(
              'p-1 rounded-md hover:bg-destructive/10 opacity-0 group-hover/tree-row:opacity-100',
              !hasExplicitRule && 'invisible pointer-events-none'
            )}
            aria-label='Remove rule'>
            <Trash2 className='size-4 text-muted-foreground hover:text-destructive' />
          </button>
        </Tooltip>
      )}
    </>
  )
}
