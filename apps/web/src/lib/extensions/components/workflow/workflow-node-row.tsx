// apps/web/src/lib/extensions/components/workflow/workflow-node-row.tsx

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'

/** Variant styles for WorkflowNodeRow */
type RowVariant = 'default' | 'success' | 'error' | 'warning'

/** Props for WorkflowNodeRow component */
interface WorkflowNodeRowProps {
  /** Label text to display in the row */
  label: string
  /** Visual variant for the row */
  variant?: RowVariant
  /** Optional child elements (e.g., handles, icons) */
  children?: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

/**
 * WorkflowNodeRow component.
 * A row within a workflow node with label and optional handle.
 */
export const WorkflowNodeRow = ({
  label,
  variant = 'default',
  children,
  className,
}: WorkflowNodeRowProps) => {
  const variantClasses: Record<RowVariant, string> = {
    default: 'bg-primary-100 text-card-foreground',
    success: 'bg-green-50 text-green-900',
    error: 'bg-red-50 text-red-900',
    warning: 'bg-yellow-50 text-yellow-900',
  }

  return (
    <div
      className={cn(
        'flex items-center flex items-start justify-start rounded-md p-1 text-sm font-medium mx-2',
        variantClasses[variant],
        className
      )}>
      <span>{label}</span>
      {children && <div className='ml-2'>{children}</div>}
    </div>
  )
}
