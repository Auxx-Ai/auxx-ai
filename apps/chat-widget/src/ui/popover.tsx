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
          'z-50 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3 text-sm shadow-md outline-none',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
