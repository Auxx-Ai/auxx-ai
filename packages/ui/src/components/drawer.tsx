'use client'

import { cn } from '@auxx/ui/lib/utils'
import { X } from 'lucide-react'
import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { Button } from './button'
import { Separator } from './separator'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

/** Context for managing drawer resize state */
const DrawerResizeContext = React.createContext<{
  width: number
  setWidth: (width: number) => void
  minWidth: number
  maxWidth: number
  defaultWidth: number
  onWidthChange?: (width: number) => void
} | null>(null)

const useDrawerResize = () => {
  const context = React.useContext(DrawerResizeContext)
  if (!context) {
    throw new Error('useDrawerResize must be used within DrawerResizeProvider')
  }
  return context
}

const Drawer = ({
  shouldScaleBackground = true,
  nested = false,
  defaultWidth = 600,
  minWidth = 300,
  maxWidth = 1200,
  onWidthChange,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root> & {
  nested?: boolean
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  /** Callback when width changes via resize handle */
  onWidthChange?: (width: number) => void
}) => {
  const Component = nested ? DrawerPrimitive.NestedRoot : DrawerPrimitive.Root
  const [width, setWidthInternal] = React.useState(defaultWidth)

  /** Wrapper that updates internal state and notifies parent */
  const setWidth = React.useCallback(
    (newWidth: number) => {
      setWidthInternal(newWidth)
      onWidthChange?.(newWidth)
    },
    [onWidthChange]
  )

  return (
    <DrawerResizeContext.Provider
      value={{ width, setWidth, minWidth, maxWidth, defaultWidth, onWidthChange }}>
      <Component shouldScaleBackground={shouldScaleBackground} {...props} />
    </DrawerResizeContext.Provider>
  )
}
Drawer.displayName = 'Drawer'

const DrawerNestedRoot = ({
  shouldScaleBackground = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.NestedRoot>) => (
  <DrawerPrimitive.NestedRoot shouldScaleBackground={shouldScaleBackground} {...props} />
)
DrawerNestedRoot.displayName = 'DrawerNestedRoot'

const DrawerTrigger = DrawerPrimitive.Trigger

const DrawerPortal = DrawerPrimitive.Portal

const DrawerClose = DrawerPrimitive.Close

// const DrawerHandle = DrawerPrimitive.Handle

function DrawerHandle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Handle>) {
  const context = React.useContext(DrawerResizeContext)
  const { setWidth, minWidth, maxWidth } = context || {}
  const [isDragging, setIsDragging] = React.useState(false)

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      if (!setWidth) return
      e.preventDefault()
      setIsDragging(true)

      const startX = e.clientX
      const startWidth = context?.width || 600

      const handleMouseMove = (moveEvent: MouseEvent) => {
        // Calculate new width (drawer is on right, so we subtract the movement)
        const deltaX = startX - moveEvent.clientX
        const newWidth = Math.min(maxWidth || 1200, Math.max(minWidth || 300, startWidth + deltaX))
        setWidth(newWidth)
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [setWidth, minWidth, maxWidth, context?.width]
  )

  // If no context, fall back to default Vaul handle
  if (!context) {
    return (
      <div
        className={cn(
          'absolute! -left-[3px]! top-1/2 -translate-y-1/2 h-12! w-1.5! bg-primary-400! cursor-ew-resize rounded-r-md hover:bg-primary-300 mx-0!',
          className
        )}
        {...props}
      />
    )
  }

  return (
    <div
      className={cn(
        'absolute -left-[3px] top-1/2 -translate-y-1/2 h-12 w-1.5 bg-primary-300 cursor-ew-resize rounded-r-md hover:bg-primary-400/70 rounded-full mx-0 z-50',
        isDragging && 'bg-primary-500',
        className
      )}
      onMouseDown={handleMouseDown}
      {...props}
    />
  )
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-black/80', className)}
      {...props}
    />
  )
}
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName

function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  const context = React.useContext(DrawerResizeContext)
  const width = context?.width

  return (
    <DrawerPortal>
      {/* Re-provide context inside portal so children can access it */}
      <DrawerResizeContext.Provider value={context}>
        <DrawerPrimitive.Content
          className={cn(
            'right-0 top-0 bottom-0 fixed z-50 outline-hidden flex flex-col shadow-left dark:border-l bg-background/70 backdrop-blur-sm overflow-visible max-sm:w-screen!',
            className
          )}
          style={width ? { width: `${width}px` } : undefined}
          {...props}>
          {children}
        </DrawerPrimitive.Content>
      </DrawerResizeContext.Provider>
    </DrawerPortal>
  )
}
DrawerContent.displayName = 'DrawerContent'

/** Props for DrawerHeader component */
interface DrawerHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Icon element (use EntityIcon or similar) */
  icon?: React.ReactNode
  /** Title - can be static text or Input for editable titles */
  title?: React.ReactNode
  /** Action buttons to display before the close button */
  actions?: React.ReactNode
  /** Callback when close button is clicked */
  onClose?: () => void
}

/**
 * Standardized drawer header with icon, title, actions, and close button.
 * Use this component for consistent drawer headers across the application.
 */
const DrawerHeader = ({
  className,
  icon,
  title,
  actions,
  onClose,
  children,
  ...props
}: DrawerHeaderProps) => (
  <div
    className={cn(
      'sticky top-0 z-10 border-b-[0.5px] border-divider-regular backdrop-blur-sm bg-background/60 rounded-t-xl',
      className
    )}
    {...props}>
    <div className='flex items-center ps-2 pe-1 pt-1.5 pb-1 relative z-10'>
      {/* Icon */}
      {icon && <div className='mr-1 shrink-0'>{icon}</div>}

      {/* Title area - flexible, supports text or Input */}
      <div className='relative flex-1 pr-2 min-w-0 w-full text-sm text-primary-500'>{title}</div>

      {/* Actions + Separator + Close */}
      <div className='flex shrink-0 items-center gap-1'>
        {actions}
        {onClose && (
          <>
            <Separator orientation='vertical' className='h-6 mx-1' />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon-xs'
                  className='rounded-full'
                  onClick={onClose}
                  tabIndex={-1}>
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>

    {/* Optional additional content (e.g., description) */}
    {children}
  </div>
)
DrawerHeader.displayName = 'DrawerHeader'

const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mt-auto flex flex-col gap-2 p-4', className)} {...props} />
)
DrawerFooter.displayName = 'DrawerFooter'

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      className={cn('text-lg font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
}
DrawerTitle.displayName = DrawerPrimitive.Title.displayName

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}
DrawerDescription.displayName = DrawerPrimitive.Description.displayName

export {
  Drawer,
  DrawerNestedRoot,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
  type DrawerHeaderProps,
}
