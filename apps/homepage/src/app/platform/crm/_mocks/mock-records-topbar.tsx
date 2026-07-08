// apps/homepage/src/app/platform/crm/_mocks/mock-records-topbar.tsx

import { BarChart3, type LucideIcon, PanelLeft, Plus, Settings, Users } from 'lucide-react'
import { cn } from '~/lib/utils'

interface MockRecordsTopbarProps {
  /** Page label on the left (e.g. "Support Tickets"). */
  title: string
  /** Primary-button label (rendered as "+ {newLabel}"). */
  newLabel: string
  /** Icon for the active "Records" segment. Default `Users`. */
  tabIcon?: LucideIcon
  className?: string
}

/**
 * Static facsimile of the real records-page top bar (see `/app/tickets`):
 * page label on the left, a segmented Records/Dashboard/Settings control,
 * and a primary "+ New …" button.
 */
export function MockRecordsTopbar({
  title,
  newLabel,
  tabIcon: TabIcon = Users,
  className,
}: MockRecordsTopbarProps) {
  return (
    <div
      className={cn('flex items-center gap-3 pb-2 text-xs text-mock-window-foreground', className)}>
      <div className='flex min-w-0 items-center gap-2 text-mock-window-muted'>
        <PanelLeft className='size-3.5 shrink-0' />
        <span className='truncate text-mock-window-foreground'>{title}</span>
      </div>

      <div className='hidden items-center gap-0.5 rounded-lg border border-mock-window-border bg-mock-panel-bg p-0.5 sm:flex'>
        <span className='flex items-center gap-1.5 rounded-md bg-mock-window px-2.5 py-1 font-medium shadow-sm'>
          <TabIcon className='size-3' />
          Records
        </span>
        <span className='flex items-center gap-1.5 rounded-md px-2.5 py-1 text-mock-window-muted'>
          <BarChart3 className='size-3' />
          Dashboard
        </span>
        <span className='flex items-center gap-1.5 rounded-md px-2.5 py-1 text-mock-window-muted'>
          <Settings className='size-3' />
          Settings
        </span>
      </div>

      <div className='ml-auto inline-flex shrink-0 items-center gap-1 rounded-md bg-blue-500 px-2 py-1 font-medium text-white'>
        <Plus className='size-3' />
        <span>{newLabel}</span>
      </div>
    </div>
  )
}
