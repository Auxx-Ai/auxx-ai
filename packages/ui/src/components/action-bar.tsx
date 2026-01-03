// packages/ui/src/components/action-bar.tsx
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

/** Animation duration in milliseconds (matches CSS) */
const ANIMATION_DURATION = 200

/** Internal context for ActionBar to pass onClose to children */
interface ActionBarInternalContextValue {
  onClose?: () => void
}

const ActionBarInternalContext = React.createContext<ActionBarInternalContextValue | undefined>(
  undefined
)

/** ActionBar variants */
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

/** Position classes for ActionBar placement */
const positionClasses = {
  'top-left': 'top-4 left-4',
  'top-center': 'top-4 left-1/2 -translate-x-1/2',
  'top-right': 'top-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'bottom-center': 'bottom-8 left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-4 right-4',
} as const

/** Returns animation styles for visibility and slide */
const getAnimationStyles = (
  position: keyof typeof positionClasses,
  isVisible: boolean
): React.CSSProperties => {
  const isBottom = position.startsWith('bottom')
  return {
    transition: `opacity ${ANIMATION_DURATION}ms ease-out, transform ${ANIMATION_DURATION}ms ease-out`,
    opacity: isVisible ? 1 : 0,
    transform: isVisible ? 'translateY(0)' : `translateY(${isBottom ? '16px' : '-16px'})`,
  }
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
 * Root ActionBar component with portal rendering and CSS transition animations.
 * Uses timeout-based unmounting for reliable exit animations.
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
  const [shouldRender, setShouldRender] = React.useState(false)
  const [isVisible, setIsVisible] = React.useState(false)
  const autoDismissRef = React.useRef<NodeJS.Timeout | undefined>(undefined)
  const exitTimeoutRef = React.useRef<NodeJS.Timeout | undefined>(undefined)

  // Handle mounting and visibility transitions
  React.useEffect(() => {
    if (open) {
      // Clear any pending exit timeout
      if (exitTimeoutRef.current) {
        clearTimeout(exitTimeoutRef.current)
        exitTimeoutRef.current = undefined
      }
      // Mount immediately, then trigger animation on next frame
      setShouldRender(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true)
        })
      })
    } else if (shouldRender) {
      // Start exit animation
      setIsVisible(false)
      // Unmount after animation completes
      exitTimeoutRef.current = setTimeout(() => {
        setShouldRender(false)
      }, ANIMATION_DURATION)
    }
  }, [open, shouldRender])

  // Auto-dismiss timer
  React.useEffect(() => {
    if (open && duration && duration !== Infinity) {
      autoDismissRef.current = setTimeout(() => {
        onOpenChange?.(false)
      }, duration)
      return () => {
        if (autoDismissRef.current) {
          clearTimeout(autoDismissRef.current)
        }
      }
    }
  }, [open, duration, onOpenChange])

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (autoDismissRef.current) clearTimeout(autoDismissRef.current)
      if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current)
    }
  }, [])

  // Context value for children
  const contextValue = React.useMemo(
    () => ({ onClose: () => onOpenChange?.(false) }),
    [onOpenChange]
  )

  if (!shouldRender) return null
  if (typeof document === 'undefined') return null

  return ReactDOM.createPortal(
    <div className={cn('fixed z-20', positionClasses[position])}>
      <div
        className={cn(
          'backdrop-blur-sm border border-border shadow-lg rounded-2xl ps-2 py-1 pe-1 bg-transparent',
          variant === 'destructive' &&
            'border-destructive bg-destructive text-destructive-foreground',
          className
        )}
        style={getAnimationStyles(position, isVisible)}
        {...props}>
        <ActionBarInternalContext.Provider value={contextValue}>
          <div className={cn(actionBarVariants({ variant, size }))}>{children}</div>
        </ActionBarInternalContext.Provider>
      </div>
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
          <Badge variant="pill" size="sm" className="min-w-6 items-center justify-center">
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
