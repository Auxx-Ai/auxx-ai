'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Popover as PopoverPrimitive } from 'radix-ui'
import * as React from 'react'
import { DialogContext } from './dialog'

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const popoverContentClassName =
  'pointer-events-auto flex flex-col z-50 w-72 focus:outline-none rounded-2xl border border-foreground/15 bg-popover/70 p-4 text-popover-foreground shadow-sm shadow-black/10 dark:shadow-black/50 outline-hidden inset-shadow-2xs inset-shadow-white/25 backdrop-blur-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 max-h-[var(--radix-popover-content-available-height)]'

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(popoverContentClassName, className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

/**
 * Popover content that renders inside dialog's portal container when in dialog context.
 * Use this for popovers that need to work inside dialogs without focus conflicts.
 */
function PopoverContentDialogAware({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const { isInsideDialog, portalContainerRef } = React.useContext(DialogContext)

  const content = (
    <PopoverPrimitive.Content
      align={align}
      sideOffset={sideOffset}
      className={cn(popoverContentClassName, className)}
      {...props}
    />
  )

  // Use dialog's portal container if available
  if (isInsideDialog && portalContainerRef?.current) {
    return (
      <PopoverPrimitive.Portal container={portalContainerRef.current}>
        {content}
      </PopoverPrimitive.Portal>
    )
  }

  return <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal>
}

export { Popover, PopoverTrigger, PopoverContent, PopoverContentDialogAware, PopoverAnchor }
