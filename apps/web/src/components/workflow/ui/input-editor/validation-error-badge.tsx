// apps/web/src/components/workflow/ui/input-editor/validation-error-badge.tsx

import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { cn } from '@auxx/ui/lib/utils'

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
            ? 'bg-red-50 text-red-400 border-red-300'
            : 'bg-yellow-50 text-yellow-400 border-yellow-300',
          className
        )}>
        <AlertTriangle className="size-3" />
      </div>
    </Tooltip>
  )
}
