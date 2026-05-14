// apps/web/src/components/agents/ui/shared/autosave-indicator.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { Check, Loader2 } from 'lucide-react'

export type AutosaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: number }

interface AutosaveIndicatorProps {
  state: AutosaveState
  className?: string
}

/**
 * Header pill that surfaces autosave status. Renders nothing on idle.
 *
 * v1 only lights up on archive/unarchive — full debounced field autosave wiring
 * lands inside the per-tab follow-up plans.
 */
export function AutosaveIndicator({ state, className }: AutosaveIndicatorProps) {
  if (state.kind === 'idle') return null
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 text-xs text-muted-foreground px-1.5 py-0.5',
        className
      )}>
      {state.kind === 'saving' ? (
        <>
          <Loader2 className='size-3 animate-spin' />
          <span>Saving…</span>
        </>
      ) : (
        <>
          <Check className='size-3 text-good-500' />
          <span>Saved {formatDistanceToNow(state.at, { addSuffix: true })}</span>
        </>
      )}
    </div>
  )
}
