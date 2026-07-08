// apps/web/src/components/dashboard/ui/widget/widget-states.tsx
'use client'

// The four non-data states a widget body can render in place of content:
// loading, empty, error, and unconfigured. All centered, muted, and sized to
// fill the widget body (`flex-1 min-h-0`). Errors render here — never a toast —
// so one broken widget stays contained (house rule: errors in place).

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { AlertCircle, Settings2 } from 'lucide-react'
import type { ReactNode } from 'react'

function StateShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-1 min-h-0 flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground text-sm',
        className
      )}>
      {children}
    </div>
  )
}

/** Rough per-body skeleton — a block for charts, stacked lines for lists. */
export function WidgetSkeleton({ variant = 'chart' }: { variant?: 'chart' | 'list' | 'value' }) {
  if (variant === 'value') {
    return (
      <div className='flex flex-1 min-h-0 flex-col justify-center gap-2 p-4'>
        <Skeleton className='h-8 w-24' />
        <Skeleton className='h-4 w-16' />
      </div>
    )
  }
  if (variant === 'list') {
    return (
      <div className='flex flex-1 min-h-0 flex-col gap-2 p-3'>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className='h-6 w-full' />
        ))}
      </div>
    )
  }
  return (
    <div className='flex flex-1 min-h-0 p-3'>
      <Skeleton className='h-full w-full' />
    </div>
  )
}

/** No rows came back for the current filters. */
export function WidgetEmpty({ message = 'No data — adjust filters' }: { message?: string }) {
  return <StateShell>{message}</StateShell>
}

/** In-place error (no toast). One broken widget can't take down the grid. */
export function WidgetError({ message }: { message?: string }) {
  return (
    <StateShell className='text-destructive'>
      <AlertCircle className='size-5' />
      <span>{message ?? 'Something went wrong'}</span>
    </StateShell>
  )
}

/**
 * The widget has no runnable config yet (no source/metric, or no iframe URL).
 * In edit mode, offers a CTA to open the config panel via `onConfigure`.
 */
export function WidgetUnconfigured({
  message = 'Configure this widget',
  onConfigure,
}: {
  message?: string
  onConfigure?: () => void
}) {
  return (
    <StateShell>
      <Settings2 className='size-5' />
      <span>{message}</span>
      {onConfigure && (
        <Button variant='outline' size='sm' onClick={onConfigure}>
          Configure
        </Button>
      )}
    </StateShell>
  )
}
