// apps/web/src/lib/extensions/components/workflow/workflow-panel.tsx

import React from 'react'
import { cn } from '@auxx/ui/lib/utils'

/** Props for WorkflowPanel component */
interface WorkflowPanelProps {
  /** Child elements to render inside the panel */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

/**
 * WorkflowPanel component.
 * Container for configuration panel.
 */
export const WorkflowPanel = ({ children, className }: WorkflowPanelProps) => {
  return <div className={cn('flex flex-col', className)}>{children}</div>
}
