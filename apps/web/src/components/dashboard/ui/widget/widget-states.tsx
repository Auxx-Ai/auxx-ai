// apps/web/src/components/dashboard/ui/widget/widget-states.tsx
'use client'

// The non-data states a widget body can render in place of content: loading,
// empty, error, unconfigured, and unavailable-source. All centered, muted, and
// sized to fill the widget body (`flex-1 min-h-0`). Errors render here — never a
// toast — so one broken widget stays contained (house rule: errors in place).

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { AlertCircle, Settings2, Unplug } from 'lucide-react'
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
 * The widget's STORED data source can no longer be queried — today only the mail
 * tables (`thread` / `message`), which every generic server path now refuses so
 * that the mail lens in `mail-query/` stays the single authority on thread
 * content.
 *
 * **Deliberately not {@link WidgetError}.** Nothing failed and nothing is
 * broken: the widget is a valid document naming a source the platform withdrew,
 * and a red `AlertCircle` would send its owner hunting a fault that does not
 * exist. It is also not {@link WidgetEmpty} ("adjust filters" is advice that
 * cannot work here) and not {@link WidgetUnconfigured} — there is nothing to
 * configure that would bring the source back.
 *
 * So it borrows the shape the dashboard already uses for "this tile is telling
 * you something, quietly": muted body text, a plain-language line, and the
 * explanation on hover — the same restraint as `DroppedFiltersNotice`
 * (`dynamic-table/components/dropped-filters-notice.tsx`), one level up because a
 * missing source removes the whole body rather than qualifying a footer. The
 * hover text is the only place mail is named, so the resting state does not
 * accuse the viewer of lacking permission — this is not a per-viewer verdict.
 */
export function WidgetDataSourceUnavailable({
  detail = 'Threads and messages are only searchable in Mail, where per-conversation visibility applies. Delete this widget or point it at another source.',
}: {
  /** Overrides the hover explanation; the resting line is fixed on purpose. */
  detail?: string
}) {
  return (
    <StateShell>
      <Unplug className='size-5' />
      <SimpleTooltip side='top' content={detail}>
        <span className='cursor-default border-muted-foreground/40 border-b border-dashed'>
          Data source unavailable
        </span>
      </SimpleTooltip>
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
