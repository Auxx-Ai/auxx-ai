// apps/web/src/components/workflow/nodes/shared/node-validation-warning.tsx

import { cn } from '@auxx/ui/lib/utils'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'

interface NodeValidationWarningProps {
  issues: Array<{ field: string; message: string; type: 'warning' | 'error' }>
}

/**
 * Component that displays validation warnings and errors for nodes
 * Shows different styling based on severity (errors take precedence)
 */
export function NodeValidationWarning({ issues }: NodeValidationWarningProps) {
  if (issues.length === 0) return null

  const errors = issues.filter((i) => i.type === 'error')
  const warnings = issues.filter((i) => i.type === 'warning')
  const hasErrors = errors.length > 0

  // Use error styling if any errors exist, otherwise warning styling
  const Icon = hasErrors ? AlertCircle : AlertTriangle
  const bgColor = hasErrors ? 'bg-red-100 dark:bg-red-950' : 'bg-yellow-100 dark:bg-yellow-950'
  const borderColor = hasErrors ? 'border-bad-300' : 'border-yellow-300 dark:border-yellow-700'
  const iconColor = hasErrors
    ? 'text-red-600 dark:text-red-400'
    : 'text-amber-600 dark:text-amber-400'
  const tooltipBg = hasErrors ? 'bg-bad-100' : 'bg-amber-50 dark:bg-amber-950/50'
  const tooltipText = hasErrors ? 'text-bad-500' : 'text-amber-500'

  // Create tooltip content component
  const tooltipContent = (
    <div className={cn('text-xs rounded px-2 py-1 w-[300px]', tooltipBg, tooltipText)}>
      <div className='space-y-1'>
        {errors.length > 0 && (
          <>
            <div className='font-semibold'>Errors:</div>
            {errors.map((error, idx) => (
              <div key={`error-${idx}`} className='pl-2'>
                • {error.message}
              </div>
            ))}
          </>
        )}
        {errors.length > 0 && warnings.length > 0 && (
          <div className='border-t border-current opacity-20 my-1' />
        )}
        {warnings.length > 0 && (
          <>
            <div className='font-semibold'>Warnings:</div>
            {warnings.map((warning, idx) => (
              <div key={`warning-${idx}`} className='pl-2'>
                • {warning.message}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )

  return (
    <div className='absolute -top-2 -right-2 z-1'>
      <Tooltip
        contentComponent={tooltipContent}
        side='top'
        align='end'
        sideOffset={8}
        className='p-0'>
        <div
          className={cn(
            'flex items-center justify-center size-5 border rounded-full',
            bgColor,
            borderColor
          )}>
          <Icon className={cn('size-3', iconColor)} />
        </div>
      </Tooltip>
    </div>
  )
}
