// apps/web/src/components/ui/action-bar.tsx
'use client'

import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { Slot as SlotPrimitive } from 'radix-ui'

import { cn } from '@auxx/ui/lib/utils'
import { Button, type ButtonProps } from '@auxx/ui/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@auxx/ui/components/tooltip'
import { Badge } from '@auxx/ui/components/badge'

// Internal context for ActionBar to pass onClose to children
interface ActionBarInternalContextValue {
  onClose?: () => void
}

const ActionBarInternalContext = React.createContext<ActionBarInternalContextValue | undefined>(
  undefined
)

// ActionBar variants
const actionBarVariants = cva('flex flex-row justify-start items-center gap-12 w-full', {
  variants: {
    variant: {
      default: 'text-foreground',
      destructive: 'text-destructive-foreground',
    },
    size: {
      default: 'min-w-96 max-w-4xl',
      sm: 'min-w-80 max-w-lg',
      lg: 'min-w-[32rem] max-w-4xl',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
})

// Position classes for ActionBar placement
const positionClasses = {
  'top-left': 'top-4 left-4',
  'top-center': 'top-4 left-1/2 -translate-x-1/2',
  'top-right': 'top-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'bottom-center': 'bottom-8 left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-4 right-4',
} as const

// Animation classes based on position
const getAnimationClasses = (position: keyof typeof positionClasses, state: string) => {
  const isBottom = position.startsWith('bottom')
  const isTop = position.startsWith('top')

  if (state === 'entering') {
    if (isBottom) {
      return 'animate-in fade-in slide-in-from-bottom duration-300'
    } else if (isTop) {
      return 'animate-in fade-in slide-in-from-top duration-300'
    }
  } else if (state === 'exiting') {
    if (isBottom) {
      return 'animate-out fade-out slide-out-to-bottom duration-300'
    } else if (isTop) {
      return 'animate-out fade-out slide-out-to-top duration-300'
    }
  }
  return ''
}

export interface ActionBarProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof actionBarVariants> {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  duration?: number
  position?: keyof typeof positionClasses
}

/**
 * Root ActionBar component with portal rendering and animations
 */
const ActionBar = ({
  className,
  variant,
  size,
  open = false,
  onOpenChange,
  duration = 60000,
  position = 'bottom-center',
  children,
  ...props
}: ActionBarProps) => {
  const [animationState, setAnimationState] = React.useState<
    'hidden' | 'entering' | 'visible' | 'exiting'
  >('hidden')
  const [shouldRender, setShouldRender] = React.useState(false)
  const timerRef = React.useRef<NodeJS.Timeout | undefined>(undefined)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Handle open/close with animation states
  React.useEffect(() => {
    if (open && !shouldRender) {
      setShouldRender(true)
      // Use requestAnimationFrame to ensure DOM is ready before animation
      requestAnimationFrame(() => {
        setAnimationState('entering')
      })
    } else if (!open && shouldRender) {
      setAnimationState('exiting')
    }
  }, [open, shouldRender])

  // Handle animation end
  const handleAnimationEnd = React.useCallback(() => {
    if (animationState === 'entering') {
      setAnimationState('visible')
    } else if (animationState === 'exiting') {
      setShouldRender(false)
      setAnimationState('hidden')
    }
  }, [animationState])

  // Auto-dismiss timer
  React.useEffect(() => {
    if (open && duration && duration !== Infinity) {
      timerRef.current = setTimeout(() => {
        onOpenChange?.(false)
      }, duration)
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
        }
      }
    }
  }, [open, duration, onOpenChange])

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  // Context value for children
  const contextValue = React.useMemo(
    () => ({ onClose: () => onOpenChange?.(false) }),
    [onOpenChange]
  )

  if (!shouldRender) return null

  // Check if document is available (for SSR compatibility)
  if (typeof document === 'undefined') return null

  return ReactDOM.createPortal(
    <div
      ref={containerRef}
      className={cn(
        'fixed z-20',
        positionClasses[position],
        'backdrop-blur-sm border border-border shadow-lg rounded-2xl ps-2 py-1 pe-1 bg-transparent',
        getAnimationClasses(position, animationState),
        variant === 'destructive' &&
          'border-destructive bg-destructive text-destructive-foreground',
        className
      )}
      onAnimationEnd={handleAnimationEnd}
      {...props}>
      <ActionBarInternalContext.Provider value={contextValue}>
        <div className={cn(actionBarVariants({ variant, size }))}>{children}</div>
      </ActionBarInternalContext.Provider>
    </div>,
    document.body
  )
}

/**
 * ActionBar content container with flex layout
 */
export interface ActionBarContentProps extends React.HTMLAttributes<HTMLDivElement> {}

const ActionBarContent = ({ className, ...props }: ActionBarContentProps) => (
  <div
    className={cn('flex flex-row justify-start items-center gap-12 flex-1', className)}
    {...props}
  />
)

/**
 * ActionBar text component with optional badge
 */
export interface ActionBarTextProps extends React.HTMLAttributes<HTMLDivElement> {
  count?: number
  label?: string
  asChild?: boolean
}

const ActionBarText = ({
  className,
  count,
  label,
  asChild = false,
  children,
  ...props
}: ActionBarTextProps) => {
  const Comp = asChild ? SlotPrimitive.Slot : 'div'

  // If using asChild, just render the slot with children
  if (asChild) {
    return (
      <Comp className={cn('text-sm font-medium text-foreground', className)} {...props}>
        {children}
      </Comp>
    )
  }

  // If count and label are provided, show badge with count and label
  if (count !== undefined || label) {
    return (
      <div className={cn('flex items-center gap-2', className)} {...props}>
        {count !== undefined && (
          <Badge variant="default" size="sm">
            {count}
          </Badge>
        )}
        {label && <span className="text-sm font-medium text-foreground">{label}</span>}
        {children}
      </div>
    )
  }

  // Default behavior - just render children
  return (
    <div className={cn('text-sm font-medium text-foreground', className)} {...props}>
      {children}
    </div>
  )
}

/**
 * ActionBar actions container for buttons
 */
export interface ActionBarActionsProps extends React.HTMLAttributes<HTMLDivElement> {}

const ActionBarActions = ({ className, ...props }: ActionBarActionsProps) => (
  <div className={cn('flex items-center justify-center gap-2 flex-1', className)} {...props} />
)

/**
 * ActionBar action item with tooltip support
 */
export interface ActionBarActionItemProps extends ButtonProps {
  tooltipText?: string
  asChild?: boolean
}

const ActionBarActionItem = ({
  tooltipText,
  asChild = false,
  children,
  variant = 'outline',
  ...props
}: ActionBarActionItemProps) => {
  // When asChild is true, don't wrap in Button - just use Slot
  if (asChild) {
    const content = <SlotPrimitive.Slot {...props}>{children}</SlotPrimitive.Slot>

    if (!tooltipText) {
      return content
    }

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltipText}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // When asChild is false, use Button as normal
  const button = (
    <Button variant={variant} {...props}>
      {children}
    </Button>
  )

  if (!tooltipText) {
    return button
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * ActionBar close button
 */
export interface ActionBarCloseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

const ActionBarClose = ({ className, ...props }: ActionBarCloseProps) => {
  const context = React.useContext(ActionBarInternalContext)

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    context?.onClose?.()
    props.onClick?.(event)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('hover:bg-background', className)}
      onClick={handleClick}
      {...props}>
      <X className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </Button>
  )
}

export {
  ActionBar,
  ActionBarContent,
  ActionBarText,
  ActionBarActions,
  ActionBarActionItem,
  ActionBarClose,
  actionBarVariants,
}
