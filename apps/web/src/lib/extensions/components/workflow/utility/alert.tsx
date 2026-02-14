// apps/web/src/lib/extensions/components/workflow/utility/alert.tsx

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'

type AlertProps = {
  variant: 'info' | 'warning' | 'error' | 'success'
  title?: string
  children: React.ReactElement
  className?: string
}
/**
 * WorkflowAlert component.
 * Displays informational messages with variant styling.
 */
export const WorkflowAlert = ({
  variant = 'info',
  title,
  children,
  className = '',
}: AlertProps) => {
  const variantClasses = {
    info: 'bg-blue-50 text-blue-900 border-blue-200',
    warning: 'bg-yellow-50 text-yellow-900 border-yellow-200',
    error: 'bg-red-50 text-red-900 border-red-200',
    success: 'bg-green-50 text-green-900 border-green-200',
  }

  return (
    <div
      role='alert'
      className={cn('relative w-full rounded-lg border p-4', variantClasses[variant], className)}>
      {title && <h5 className='mb-1 font-medium leading-none tracking-tight'>{title}</h5>}
      <div className='text-sm [&_p]:leading-relaxed'>{children}</div>
    </div>
  )
}
