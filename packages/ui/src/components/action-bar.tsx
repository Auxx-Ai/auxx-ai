// packages/ui/src/components/action-bar.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'

import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, X } from 'lucide-react'
import * as React from 'react'
import * as ReactDOM from 'react-dom'

/** Animation duration in milliseconds (matches CSS) */
const ANIMATION_DURATION = 200

/** Position classes for ActionBar placement */
const positionClasses = {
  'top-left': 'top-4 left-4',
  'top-center': 'top-4 left-1/2 -translate-x-1/2',
  'top-right': 'top-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'bottom-center': 'bottom-8 left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-4 right-4',
} as const

/**
 * Picker component interface - components used with picker config must implement this
 */
export interface PickerComponentProps {
  children?: React.ReactNode
  anchorRef?: React.RefObject<HTMLElement | null>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  [key: string]: any
}

/**
 * Action definition for ActionBar
 */
export interface ActionBarAction {
  /** Unique identifier */
  id: string
  /** Display label */
  label: string
  /** Icon component */
  icon?: React.ComponentType<{ className?: string }>
  /** Click handler - required unless picker is defined */
  onClick?: () => void
  /** Disabled state */
  disabled?: boolean
  /** Hidden state - action won't render at all */
  hidden?: boolean
  /** Button variant */
  variant?: 'default' | 'outline' | 'destructive' | 'secondary' | 'ghost'
  /** Tooltip text */
  tooltip?: string
  /** Keyboard shortcut hint */
  shortcut?: string
  /**
   * Picker configuration for actions that open pickers/popovers.
   * ActionBar automatically handles both visible and overflow cases.
   */
  picker?: {
    component: React.ComponentType<PickerComponentProps>
    props: Record<string, any>
  }
}

/**
 * ActionBar props
 */
export interface ActionBarProps {
  /** Controls visibility with enter/exit animation */
  open?: boolean
  /** Callback when visibility changes */
  onOpenChange?: (open: boolean) => void
  /** Auto-dismiss duration in ms (Infinity to disable) */
  duration?: number
  /** Position on screen */
  position?: keyof typeof positionClasses
  /** Variant styling */
  variant?: 'default' | 'destructive'
  /** Size variant */
  size?: 'default' | 'sm' | 'lg'
  /** Selected items count (shows badge) */
  selectedCount?: number
  /** Label after count (e.g., "selected") */
  selectedLabel?: string
  /** Array of action definitions */
  actions: ActionBarAction[]
  /** Show close button */
  showClose?: boolean
  /** Custom className */
  className?: string
}

/**
 * Helper component for rendering individual action buttons
 */
const ActionButton = React.forwardRef<
  HTMLDivElement,
  { action: ActionBarAction; className?: string }
>(({ action, className }, ref) => {
  const Icon = action.icon
  const isDisabled = action.disabled ?? false

  // If action has picker, wrap button with picker component
  if (action.picker) {
    const PickerComponent = action.picker.component
    return (
      <div ref={ref} data-action-id={action.id} className={cn('shrink-0', className)}>
        <PickerComponent disabled={isDisabled} {...action.picker.props}>
          <Button variant={action.variant || 'outline'} size='sm' disabled={isDisabled}>
            {Icon && <Icon />}
            {action.label}
            {action.shortcut && (
              <span className='ml-2 text-xs text-muted-foreground'>{action.shortcut}</span>
            )}
          </Button>
        </PickerComponent>
      </div>
    )
  }

  // Regular button
  return (
    <Button
      ref={ref as React.Ref<HTMLButtonElement>}
      data-action-id={action.id}
      variant={action.variant || 'outline'}
      size='sm'
      disabled={isDisabled}
      onClick={action.onClick}
      className={cn('shrink-0', className)}>
      {Icon && <Icon />}
      {action.label}
      {action.shortcut && (
        <span className='ml-2 text-xs text-muted-foreground'>{action.shortcut}</span>
      )}
    </Button>
  )
})
ActionButton.displayName = 'ActionButton'

/**
 * Root ActionBar component with portal rendering, CSS transition animations,
 * and automatic overflow handling.
 */
function ActionBar({
  open = false,
  onOpenChange,
  duration = 60000,
  position = 'bottom-center',
  variant = 'default',
  selectedCount,
  selectedLabel,
  actions,
  showClose = true,
  className,
}: ActionBarProps) {
  // Animation state
  const [shouldRender, setShouldRender] = React.useState(false)
  const [isVisible, setIsVisible] = React.useState(false)

  // Refs
  const actionsRef = React.useRef<HTMLDivElement>(null)
  const overflowButtonRef = React.useRef<HTMLButtonElement>(null)

  // Filter hidden actions
  const visibleActions = React.useMemo(() => actions.filter((a) => !a.hidden), [actions])

  // Track how many actions fit
  const [visibleCount, setVisibleCount] = React.useState(visibleActions.length)

  // Track which overflow picker is open
  const [openPickerId, setOpenPickerId] = React.useState<string | null>(null)

  // Split into display vs overflow based on count
  const displayActions = visibleActions.slice(0, visibleCount)
  const overflowActions = visibleActions.slice(visibleCount)

  // Animation effect
  React.useEffect(() => {
    if (open) {
      setShouldRender(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true))
      })
    } else if (shouldRender) {
      setIsVisible(false)
      const timeout = setTimeout(() => setShouldRender(false), ANIMATION_DURATION)
      return () => clearTimeout(timeout)
    }
  }, [open, shouldRender])

  // Measure and calculate overflow
  const calculateVisibleCount = React.useCallback(() => {
    const actionsContainer = actionsRef.current
    if (!actionsContainer) return

    const buttons = actionsContainer.querySelectorAll('[data-action-id]')
    if (buttons.length === 0) return

    // Max width is 100vw - 2rem (32px), minus internal spacing
    const maxWidth = window.innerWidth - 32
    const GAP = 12 // gap-3
    const OVERFLOW_BUTTON_WIDTH = 100
    const CLOSE_BUTTON_WIDTH = 40
    const SELECTION_WIDTH = selectedCount !== undefined ? 100 : 0 // Approximate
    const PADDING = 16 // ps-2 (8px) + pe-1 (4px) + border

    // Available width for actions
    const baseAvailable = maxWidth - SELECTION_WIDTH - CLOSE_BUTTON_WIDTH - PADDING - GAP * 2

    let totalWidth = 0
    let count = 0
    const buttonGap = 8 // gap-2

    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i] as HTMLElement
      const btnWidth = btn.getBoundingClientRect().width
      const widthNeeded = totalWidth + btnWidth + (i > 0 ? buttonGap : 0)

      // Reserve space for overflow button if more actions exist
      const hasMoreActions = i < visibleActions.length - 1
      const availableWidth = hasMoreActions
        ? baseAvailable - OVERFLOW_BUTTON_WIDTH - GAP
        : baseAvailable

      if (widthNeeded <= availableWidth) {
        totalWidth = widthNeeded
        count++
      } else {
        break
      }
    }
    console.log(totalWidth, count)

    if (count !== visibleCount) {
      setVisibleCount(count)
    }
  }, [visibleActions.length, visibleCount, selectedCount])

  // Measure on mount and after renders
  React.useLayoutEffect(() => {
    calculateVisibleCount()
  })

  // Reset when actions change
  React.useLayoutEffect(() => {
    setVisibleCount(visibleActions.length)
  }, [visibleActions.length])

  // Window resize listener
  React.useEffect(() => {
    window.addEventListener('resize', calculateVisibleCount)
    return () => window.removeEventListener('resize', calculateVisibleCount)
  }, [calculateVisibleCount])

  // Auto-dismiss timer
  React.useEffect(() => {
    if (open && duration && duration !== Infinity) {
      const timeout = setTimeout(() => onOpenChange?.(false), duration)
      return () => clearTimeout(timeout)
    }
  }, [open, duration, onOpenChange])

  if (!shouldRender || typeof document === 'undefined') return null

  const animationStyles = {
    transition: `opacity ${ANIMATION_DURATION}ms ease-out, transform ${ANIMATION_DURATION}ms ease-out`,
    opacity: isVisible ? 1 : 0,
    transform: isVisible
      ? 'translateY(0)'
      : `translateY(${position.startsWith('bottom') ? '16px' : '-16px'})`,
  }

  return ReactDOM.createPortal(
    <div className={cn('fixed z-20 max-w-[calc(100vw-2rem)]', positionClasses[position])}>
      <div
        className={cn(
          'backdrop-blur-sm border border-border shadow-lg rounded-2xl ps-2 py-1 pe-1 bg-transparent',
          variant === 'destructive' &&
            'border-destructive bg-destructive text-destructive-foreground',
          className
        )}
        style={animationStyles}>
        <div className='flex items-center gap-3'>
          {/* Selection count */}
          {selectedCount !== undefined && (
            <div className='flex items-center gap-2 shrink-0'>
              <Badge variant='pill' size='sm' className='min-w-6 justify-center'>
                {selectedCount}
              </Badge>
              {selectedLabel && <span className='text-sm font-medium'>{selectedLabel}</span>}
            </div>
          )}

          {/* Hidden measurement container - all buttons for measuring */}
          <div
            ref={actionsRef}
            className='flex items-center gap-2 absolute opacity-0 pointer-events-none'
            aria-hidden='true'>
            {visibleActions.map((action) => (
              <ActionButton key={action.id} action={action} />
            ))}
          </div>

          {/* Visible actions - only ones that fit */}
          <div className='flex items-center gap-2 flex-1'>
            {displayActions.map((action) => (
              <ActionButton key={action.id} action={action} />
            ))}
          </div>

          {/* Overflow button - always visible when there are overflow actions */}
          {overflowActions.length > 0 && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button ref={overflowButtonRef} variant='outline' size='sm'>
                    {displayActions.length === 0 ? (
                      'Actions...'
                    ) : (
                      <>
                        +{overflowActions.length} more
                        <ChevronDown className='ml-1 h-3 w-3' />
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  {overflowActions.map((action) => {
                    const Icon = action.icon
                    return (
                      <DropdownMenuItem
                        key={action.id}
                        disabled={action.disabled}
                        onSelect={() => {
                          console.log(
                            'Dropdown item selected:',
                            action.id,
                            'picker:',
                            !!action.picker
                          )
                          if (action.picker) {
                            // Delay to let dropdown fully close and animations finish
                            setTimeout(() => {
                              console.log('Setting openPickerId to:', action.id)
                              setOpenPickerId(action.id)
                            }, 150)
                          } else {
                            action.onClick?.()
                          }
                        }}>
                        {Icon && <Icon className='mr-2 h-4 w-4' />}
                        {action.label}
                        {action.shortcut && (
                          <span className='ml-auto text-xs text-muted-foreground'>
                            {action.shortcut}
                          </span>
                        )}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Overflow picker - rendered when open, anchored to the button */}
              {openPickerId &&
                (() => {
                  console.log('Rendering overflow picker for:', openPickerId)
                  const action = overflowActions.find((a) => a.id === openPickerId && a.picker)
                  if (!action?.picker) return null
                  const PickerComponent = action.picker.component
                  return (
                    <PickerComponent
                      key={action.id}
                      open={true}
                      onOpenChange={(pickerOpen: boolean) => {
                        console.log('Picker onOpenChange:', pickerOpen)
                        if (!pickerOpen) setOpenPickerId(null)
                      }}
                      anchorRef={overflowButtonRef}
                      disabled={action.disabled}
                      {...action.picker.props}
                    />
                  )
                })()}
            </>
          )}

          {/* Close button */}
          {showClose && (
            <Button
              variant='ghost'
              size='icon'
              className='shrink-0'
              onClick={() => onOpenChange?.(false)}>
              <X className='h-4 w-4' />
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

export { ActionBar }
export type { ActionBarAction, ActionBarProps, PickerComponentProps }
