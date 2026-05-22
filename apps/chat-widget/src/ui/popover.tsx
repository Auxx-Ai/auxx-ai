// apps/chat-widget/src/ui/popover.tsx

import type { ComponentProps } from 'preact/compat'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from '~/lib/cn'
import { usePortalContainer } from './portal-container'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  const container = usePortalContainer()
  return (
    <PopoverPrimitive.Portal container={container ?? undefined}>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          // The widget shell sits at z-index 2147483000 and creates its own
          // stacking context. The popover is portaled as a sibling of the
          // shell, so it needs to outrank it to render in front.
          'rounded-md border border-border bg-background p-3 text-sm shadow-md outline-none',
          className
        )}
        style={{ zIndex: 2147483001 }}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
