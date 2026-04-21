// empty-state.tsx

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Icon component (e.g. an SVG or any React component) */
  icon?: React.ElementType
  /** Main heading text */
  title: string
  /** Optional descriptive text */
  description?: React.ReactNode
  // description?: string
  /** Button or action element */
  button?: React.ReactNode
  iconClassName?: string
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  button,
  className,
  iconClassName,
  ...props
}) => {
  // combine base classes with any custom className

  return (
    <div className='relative flex flex-1 w-full items-center justify-center'>
      <div
        className={cn('flex flex-col items-center justify-center text-center p-8 pt-0', className)}
        {...props}>
        {/* render the passed-in icon */}
        {Icon && <Icon className={cn('mb-4 h-12 w-12 text-muted-foreground', iconClassName)} />}

        {/* title */}
        <h3 className='text-lg text-medium mb-2'>{title}</h3>

        {/* description, if provided */}
        {description && (
          <div className='text-sm text-muted-foreground mb-4 max-w-sm'>{description}</div>
        )}

        {/* button or whatever action you passed */}
        {button && button}
      </div>
    </div>
  )
}
EmptyState.displayName = 'EmptyState'

export { EmptyState }
