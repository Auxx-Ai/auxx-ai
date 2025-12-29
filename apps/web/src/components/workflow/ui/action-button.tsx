import { cn } from '@auxx/ui/lib/utils'

/**
 * Action button component for header operations
 * Reused from prompt-editor
 */
export const ActionButton: React.FC<{
  onClick?: () => void
  children: React.ReactNode
  className?: string
}> = ({ onClick, children, className }) => (
  <button
    onClick={onClick}
    className={cn(
      'flex size-6 items-center justify-center rounded hover:bg-primary-150',
      className
    )}>
    {children}
  </button>
)
