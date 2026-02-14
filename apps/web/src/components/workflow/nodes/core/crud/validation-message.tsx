// apps/web/src/components/workflow/nodes/core/crud/validation-message.tsx

'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, XCircle } from 'lucide-react'
import type React from 'react'

interface ValidationMessageProps {
  type: 'error' | 'warning'
  message: string
  className?: string
}

interface ValidationIndicatorProps {
  type: 'error' | 'warning'
  message: string
  className?: string
}

/**
 * Component for displaying validation messages
 */
export const ValidationMessage: React.FC<ValidationMessageProps> = ({
  type,
  message,
  className,
}) => {
  const isError = type === 'error'

  return (
    <div
      className={cn(
        'flex items-start gap-2 text-sm mt-1',
        isError ? 'text-red-600' : 'text-yellow-600',
        className
      )}>
      {isError ? (
        <XCircle className='h-4 w-4 mt-0.5 flex-shrink-0' />
      ) : (
        <AlertTriangle className='h-4 w-4 mt-0.5 flex-shrink-0' />
      )}
      <span className='flex-1'>{message}</span>
    </div>
  )
}

/**
 * Component for displaying validation indicator with tooltip
 */
export const ValidationIndicator: React.FC<ValidationIndicatorProps> = ({
  type,
  message,
  className,
}) => {
  const isError = type === 'error'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'absolute right-2.5 -top-3 size-5 rounded-full flex items-center justify-center border',
            isError
              ? 'bg-red-50 text-red-400 border-red-300'
              : 'bg-yellow-50 text-yellow-400 border-yellow-300',
            className
          )}>
          <AlertTriangle className='size-3' />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{message}</p>
      </TooltipContent>
    </Tooltip>
  )
}

interface ValidationSummaryProps {
  errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }>
  className?: string
}

/**
 * Component for displaying a summary of all validation errors
 */
export const ValidationSummary: React.FC<ValidationSummaryProps> = ({ errors, className }) => {
  if (errors.length === 0) return null

  const errorCount = errors.filter((e) => (e.type || 'error') === 'error').length
  const warningCount = errors.filter((e) => e.type === 'warning').length

  return (
    <div
      className={cn(
        'rounded-md border p-3 space-y-2',
        errorCount > 0 ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50',
        className
      )}>
      {errorCount > 0 && (
        <div className='flex items-center gap-2 text-sm font-medium text-red-800'>
          <XCircle className='h-4 w-4' />
          {errorCount} error{errorCount !== 1 ? 's' : ''} found
        </div>
      )}

      {warningCount > 0 && (
        <div className='flex items-center gap-2 text-sm font-medium text-yellow-800'>
          <AlertTriangle className='h-4 w-4' />
          {warningCount} warning{warningCount !== 1 ? 's' : ''} found
        </div>
      )}

      <div className='space-y-1'>
        {errors.slice(0, 5).map((error, index) => (
          <ValidationMessage
            key={`${error.field}-${index}`}
            type={error.type || 'error'}
            message={error.message}
          />
        ))}

        {errors.length > 5 && (
          <div className='text-sm text-gray-600 pl-6'>
            ... and {errors.length - 5} more issue{errors.length - 5 !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
