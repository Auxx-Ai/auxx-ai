// apps/homepage/src/app/platform/ai/_mocks/mock-kopilot-header.tsx

import { ChevronRight, PanelLeft, Plus } from 'lucide-react'
import { cn } from '~/lib/utils'

export interface MockKopilotHeaderProps {
  breadcrumb?: {
    trail: string[]
    title: string
    /** Shorter title rendered below `sm:` to keep the header on one line. */
    titleMobile?: string
  }
  className?: string
}

/**
 * Breadcrumb / title header that sits above the Kopilot panel frame.
 * Extracted out of `MockKopilotWindow` so the chat surface inside the panel
 * can be lifted in 3D independently of the header.
 */
export function MockKopilotHeader({ breadcrumb, className }: MockKopilotHeaderProps) {
  const titleMobile = breadcrumb?.titleMobile ?? breadcrumb?.title
  return (
    <div
      className={cn(
        'flex items-center justify-between pb-2 text-xs text-mock-window-foreground',
        className
      )}>
      <div className='flex min-w-0 items-center gap-2 text-mock-window-muted'>
        <PanelLeft className='size-3.5 shrink-0' />
        {breadcrumb?.trail.map((label) => (
          <span key={label} className='hidden items-center gap-2 sm:flex'>
            <span>{label}</span>
            <ChevronRight className='size-3 text-mock-window-muted' />
          </span>
        ))}
        {breadcrumb?.title ? (
          <span className='hidden max-w-[28ch] truncate text-mock-window-foreground sm:inline'>
            {breadcrumb.title}
          </span>
        ) : null}
        {titleMobile ? (
          <span className='max-w-[20ch] truncate text-mock-window-foreground sm:hidden'>
            {titleMobile}
          </span>
        ) : null}
      </div>
      <div className='inline-flex shrink-0 items-center gap-1 rounded-md border border-mock-window-border px-2 py-1 text-mock-window-foreground'>
        <Plus className='size-3' />
        <span>New chat</span>
      </div>
    </div>
  )
}
