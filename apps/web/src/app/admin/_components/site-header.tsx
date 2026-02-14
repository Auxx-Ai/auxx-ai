// apps/web/src/app/admin/_components/site-header.tsx
'use client'

import { SidebarTrigger } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'

/**
 * SiteHeader props
 */
interface SiteHeaderProps extends React.ComponentProps<'div'> {
  title?: string
  action?: React.ReactNode
}

/**
 * SiteHeader component - header for admin pages with sidebar trigger
 */
export function SiteHeader({ className, title, action, children, ...props }: SiteHeaderProps) {
  return (
    <div
      data-main='header'
      className={cn(
        'flex items-center justify-between shrink-0 py-2 px-3 overflow-x-auto no-scrollbar h-[44px] border-b bg-background',
        className
      )}
      {...props}>
      <div className='flex items-center shrink-0 gap-2'>
        <SidebarTrigger className='hover:bg-primary-200 h-6' />
        {children && <div className='flex items-center gap-1.5'>{children}</div>}
        {title && <span className='text-base font-medium'>{title}</span>}
      </div>
      {action && <div className='ml-4 space-x-2'>{action}</div>}
    </div>
  )
}
