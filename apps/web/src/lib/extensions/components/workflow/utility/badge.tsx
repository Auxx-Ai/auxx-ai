// apps/web/src/lib/extensions/components/workflow/utility/badge.tsx

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'

type WorkflowBadgeProps = {
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
  children: React.ReactElement
  className?: string
}
/**
 * WorkflowBadge component.
 * Displays small labels or status indicators with variant styling.
 */
export const WorkflowBadge = ({
  variant = 'default',
  children,
  className = '',
}: WorkflowBadgeProps) => {
  const variantClasses = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/80',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/80',
    outline: 'text-foreground border border-input bg-background hover:bg-accent',
  }

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        variantClasses[variant],
        className
      )}>
      {children}
    </div>
  )
}
