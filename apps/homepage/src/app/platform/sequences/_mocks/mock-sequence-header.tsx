// apps/homepage/src/app/platform/sequences/_mocks/mock-sequence-header.tsx

import { ChevronRight, PanelLeft, Send, Settings, Zap } from 'lucide-react'
import { cn } from '~/lib/utils'

interface MockSequenceHeaderProps {
  trail: string[]
  title: string
  /** Shorter title rendered below `sm:` so the header stays on one line. */
  titleMobile?: string
  /** Trigger badge label — omitted for `manual` sequences, like the real header. */
  trigger?: string
  className?: string
}

/**
 * Breadcrumb + actions header above the sequence panel frame. Mirrors
 * `apps/web/src/components/sequences/ui/detail/sequence-detail-view.tsx`'s
 * `MainPageHeader`: trail, trigger badge, Publish, settings gear.
 */
export function MockSequenceHeader({
  trail,
  title,
  titleMobile,
  trigger,
  className,
}: MockSequenceHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 pb-2 text-xs text-mock-window-foreground',
        className
      )}>
      <div className='flex min-w-0 items-center gap-2 text-mock-window-muted'>
        <PanelLeft className='size-3.5 shrink-0' />
        {trail.map((label) => (
          <span key={label} className='hidden items-center gap-2 sm:flex'>
            <span>{label}</span>
            <ChevronRight className='size-3' />
          </span>
        ))}
        <span className='hidden max-w-[28ch] truncate text-mock-window-foreground sm:inline'>
          {title}
        </span>
        <span className='max-w-[18ch] truncate text-mock-window-foreground sm:hidden'>
          {titleMobile ?? title}
        </span>
      </div>

      <div className='flex shrink-0 items-center gap-1.5'>
        {trigger ? (
          <span className='hidden items-center gap-1 rounded-md border border-mock-window-border px-2 py-1 text-mock-window-muted md:inline-flex'>
            <Zap className='size-3 text-amber-500' />
            {trigger}
          </span>
        ) : null}
        <span className='inline-flex items-center gap-1 rounded-md border border-mock-window-border px-2 py-1 text-mock-window-foreground'>
          <Send className='size-3' />
          Publish
        </span>
        <span className='inline-flex size-6 items-center justify-center rounded-md text-mock-window-muted'>
          <Settings className='size-3.5' />
        </span>
      </div>
    </div>
  )
}
