'use client'

import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import * as React from 'react'

// const Dialog = DialogPrimitive.Root
const Dialog: typeof DialogPrimitive.Root = (props) => (
  // this provider exists to tell downstream consumers (like Popover) that they
  // are inside a dialog and should render themselves accordingly

  <DialogProvider isInsideDialog={true}>
    <DialogPrimitive.Root {...props} />
  </DialogProvider>
)
type DialogContextValue = {
  isInsideDialog: boolean
  portalContainerRef: React.RefObject<HTMLDivElement | null> | null
}

export const DialogContext = React.createContext<DialogContextValue>({
  isInsideDialog: false,
  portalContainerRef: null,
})

const DialogProvider = ({ children }: React.PropsWithChildren<{ isInsideDialog: boolean }>) => (
  <DialogContext.Provider
    value={{
      isInsideDialog: true,
      portalContainerRef: null,
    }}>
    {children}
  </DialogContext.Provider>
)

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-50 backdrop-blur-sm transition-all duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in',
        // 'fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    />
  )
}
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const dialogVariants = cva(
  'relative z-50 grid p-[4px] focus:ring-ring/20 focus:outline-none shadow-xl dark:shadow-black/40 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 sm:rounded-[20px]',
  {
    variants: {
      variant: {
        default:
          'border ring-primary-200 backdrop-blur-sm bg-black/5 dark:border-neutral-900  dark:text-white',
      },
      position: {
        default:
          'left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95  data-[state=closed]:slide-out-to-top-16  ddata-[state=open]:slide-in-from-top-16',
        bl: 'left-6 bottom-6 data-[state=closed]:slide-out-to-bottom-16 data-[state=open]:slide-in-from-bottom-16',
        bc: 'left-[50%] top-[50%] translate-x-[-50%] bottom-6 data-[state=closed]:slide-out-to-bottom-16 data-[state=open]:slide-in-from-bottom-16',
        br: 'right-6 bottom-6 data-[state=closed]:slide-out-to-bottom-16 data-[state=open]:slide-in-from-bottom-16',
        tc: 'left-[50%] top-[10%] translate-x-[-50%] data-[state=closed]:slide-out-to-top-16  data-[state=open]:slide-in-from-top-16  data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
      },
      // `w-full` lives on each size token (not the cva base) so the content-sized
      // `content` token can use `w-fit` without a conflicting `w-full`.
      size: {
        default: 'w-full max-w-lg',
        xs: 'w-full max-w-sm',
        sm: 'w-full max-w-md',
        md: 'w-full max-w-lg',
        lg: 'w-full max-w-xl',
        xl: 'w-full max-w-2xl',
        xxl: 'w-full max-w-3xl',
        '3xl': 'w-full max-w-4xl',
        fullscreen: 'w-screen h-screen',
        // Shrink-wraps to the widest child (capped at 95vw). Use for dialogs whose
        // width is driven by their content — e.g. an animated `DialogNavPages` body.
        // On mobile it spans full-width (edge-to-edge) like the fixed-size tokens.
        content: 'w-fit max-w-[95vw] max-sm:w-full! max-sm:max-w-full!',
      },
    },
    defaultVariants: { variant: 'default', position: 'default', size: 'default' },
  }
)
//before:content-[''] before:absolute before:-top-[5%] before:left-[10%] before:w-[80%] before:h-[30%] before:-z-0 before:rounded-full before:bg-linear-to-r before:from-[#ffc58b] before:via-[#e1a6ff] before:to-[#352cee] before:opacity-100 before:blur-2xl before:mix-blend-color-dodge before:transition-opacity before:duration-1000 before:delay-1000

/** Fixed, max-width dialog size tokens (excludes `fullscreen`/`content`). */
export type DialogSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | '3xl'

/**
 * rem widths matching each `DialogSize` token's `max-w-*` class in
 * `dialogVariants` above. Hand-synced — Tailwind JIT needs the literal class
 * strings, so these can't be derived from the map. Keep the two in step.
 */
export const dialogSizeRem: Record<DialogSize, number> = {
  xs: 24, // max-w-sm
  sm: 28, // max-w-md
  md: 32, // max-w-lg
  lg: 36, // max-w-xl
  xl: 42, // max-w-2xl
  xxl: 48, // max-w-3xl
  '3xl': 56, // max-w-4xl
}

export interface DialogContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogVariants> {
  /** Whether to show the close button. Defaults to true */
  showClose?: boolean
  innerClassName?: string
}

function DialogContent({
  className,
  innerClassName,
  variant = 'default',
  size,
  position,
  showClose = true,
  children,
  ...props
}: DialogContentProps) {
  const portalContainerRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)

  // Handle Enter keyboard behavior inside the dialog:
  // - Cmd/Ctrl+Enter clicks the submit button (works from any focusable element).
  // - Plain Enter in a single-line <input> would otherwise trigger native form
  //   submission. We suppress that so Cmd/Ctrl+Enter is the only way to submit.
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return

      const content = contentRef.current
      if (!content) return
      if (!content.contains(e.target as Node)) return

      const hasModifier = e.metaKey || e.ctrlKey

      if (hasModifier) {
        const submitButton = content.querySelector<HTMLButtonElement>(
          '[data-dialog-submit]:not(:disabled), button[type="submit"]:not(:disabled)'
        )
        if (submitButton) {
          e.preventDefault()
          e.stopImmediatePropagation()
          submitButton.click()
        }
        return
      }

      // Plain Enter — block native implicit form submission when focused in a
      // single-line input. Leave textareas, contenteditable, buttons, links,
      // and selects alone so they keep their normal Enter behavior.
      const target = e.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName
      if (tag !== 'INPUT') return
      const inputType = (target as HTMLInputElement).type
      // Don't block Enter on inputs where Enter has meaningful native behavior
      // (submit/reset/button/checkbox/radio/file).
      const blockableTypes = [
        'text',
        'email',
        'password',
        'search',
        'tel',
        'url',
        'number',
        'date',
        'datetime-local',
        'month',
        'time',
        'week',
      ]
      if (!blockableTypes.includes(inputType)) return

      e.preventDefault()
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  return (
    <DialogPortal>
      <DialogOverlay />
      <div
        className='z-50 pb-6 sm:pb-20 overflow-y-auto absolute inset-0 max-sm:flex max-sm:flex-col max-sm:items-center'
        onWheel={(e) => e.stopPropagation()}>
        <DialogPrimitive.Content
          className={cn(
            dialogVariants({ variant, size, position, className }),
            'max-sm:inset-auto max-sm:translate-x-0 max-sm:translate-y-0'
          )}
          {...props}>
          <DialogContext.Provider value={{ isInsideDialog: true, portalContainerRef }}>
            <div
              ref={contentRef}
              className={cn(
                'bg-background ring-1 ring-ring/20 dark:bg-primary-100/80 p-4 relative rounded-[16px] flex flex-col min-h-0',
                innerClassName
              )}>
              {children}
              {showClose && (
                <DialogPrimitive.Close className='absolute size-7 rounded-full z-20 flex items-center justify-center shrink-0 right-1 top-1 opacity-70 ring-offset-background transition-opacity hover:bg-primary-100 dark:hover:bg-primary-200 hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring/20 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground'>
                  <X className='size-4 shrink-0' />
                  <span className='sr-only'>Close</span>
                </DialogPrimitive.Close>
              )}
            </div>
            {/* Portal container for nested popovers/tippy inside dialog */}
            <div
              ref={portalContainerRef}
              data-dialog-portal-container
              className='fixed inset-0 pointer-events-none z-[100] overflow-visible'
            />
          </DialogContext.Provider>
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  )
}
// const DialogContent = React.forwardRef<
//   React.ElementRef<typeof DialogPrimitive.Content>,
//   React.ComponentProps<typeof DialogPrimitive.Content>
// >(({ className, children, ...props }, ref) => (
//   <DialogPortal>
//     <DialogOverlay />
//     <DialogPrimitive.Content
//       ref={ref}
//       className={cn(
//         'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
//         className
//       )}
//       {...props}>
//       {children}
//       <DialogPrimitive.Close className='absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground'>
//         <X className='h-4 w-4' />
//         <span className='sr-only'>Close</span>
//       </DialogPrimitive.Close>
//     </DialogPrimitive.Content>
//   </DialogPortal>
// ))
// DialogContent.displayName = DialogPrimitive.Content.displayName

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col space-y-1.5 text-center sm:text-left mb-4', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'pt-4 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
