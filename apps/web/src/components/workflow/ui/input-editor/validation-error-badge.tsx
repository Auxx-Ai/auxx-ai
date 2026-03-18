// apps/web/src/components/workflow/ui/input-editor/validation-error-badge.tsx

import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle } from 'lucide-react'
import type React from 'react'
import { Tooltip } from '~/components/global/tooltip'

interface ValidationErrorBadgeProps {
  error?: string
  type?: 'error' | 'warning'
  className?: string
}

/**
 * Reusable validation error badge component
 * Displays a small error/warning indicator with tooltip
 */
export const ValidationErrorBadge: React.FC<ValidationErrorBadgeProps> = ({
  error,
  type = 'error',
  className,
}) => {
  if (!error) return null

  const isError = type === 'error'

  return (
    <Tooltip content={error}>
      <div
        className={cn(
          'absolute right-2.5 -top-3 size-5 rounded-full flex items-center justify-center border',
          isError
            ? 'bg-red-50 text-red-400 border-red-300 dark:bg-red-500 dark:text-red-300 dark:border-red-500'
            : 'bg-yellow-50 text-yellow-400 border-yellow-300 dark:bg-yellow-500 dark:text-yellow-300 dark:border-yellow-500',
          className
        )}>
        <AlertTriangle className='size-3' />
      </div>
    </Tooltip>
  )
}
