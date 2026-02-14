// apps/web/src/lib/extensions/components/workflow/workflow-node-text.tsx

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'

/** Props for WorkflowNodeText component */
interface WorkflowNodeTextProps {
  /** Text or elements to display */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

/**
 * WorkflowNodeText component.
 * Text content within a workflow node.
 */
export const WorkflowNodeText = ({ children, className }: WorkflowNodeTextProps) => {
  return <div className={cn('mx-2 text-sm', className)}>{children}</div>
}
