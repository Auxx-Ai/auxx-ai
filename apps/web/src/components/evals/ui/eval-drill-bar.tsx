// apps/web/src/components/evals/ui/eval-drill-bar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { useNavStack } from '@auxx/ui/components/nav-stack'
import { ChevronLeft } from 'lucide-react'

/**
 * The back bar for a pushed Simulations panel (case editor / run detail),
 * mirroring `ProcedureDetailBar`: a back chevron that pops the NavStack plus a
 * title/breadcrumb. Lives in the panel's own children (per-panel-bar layout),
 * so it slides with the panel.
 */
interface EvalDrillBarProps {
  title: React.ReactNode
  /** Trailing slot — autosave indicator, footer actions, etc. */
  actions?: React.ReactNode
}

export function EvalDrillBar({ title, actions }: EvalDrillBarProps) {
  const { pop } = useNavStack()
  return (
    <div className='flex h-10 shrink-0 items-center gap-1 border-b bg-primary-150 px-2'>
      <Button variant='ghost' size='icon-xs' onClick={pop} aria-label='Back'>
        <ChevronLeft />
      </Button>
      <div className='min-w-0 flex-1 truncate text-sm font-medium'>{title}</div>
      {actions ? <div className='flex shrink-0 items-center gap-1'>{actions}</div> : null}
    </div>
  )
}
