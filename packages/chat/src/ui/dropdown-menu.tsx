// packages/chat/src/ui/dropdown-menu.tsx

import type { ComponentProps } from 'preact/compat'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import { cn } from '~/lib/cn'
import { usePortalContainer } from './portal-container'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group
export const DropdownMenuSeparator = ({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) => (
  <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-border', className)} {...props} />
)

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const container = usePortalContainer()
  return (
    <DropdownMenuPrimitive.Portal container={container ?? undefined}>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          // See popover.tsx — must outrank `.auxx-chat-shell`'s z-index since
          // the dropdown is portaled as a sibling of the shell stacking ctx.
          'min-w-[10rem] overflow-hidden rounded-xl border border-border bg-[color:var(--auxx-chat-surface-loud)] p-1 text-sm shadow-md backdrop-blur-xl',
          className
        )}
        style={{ zIndex: 2147483001 }}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-[color:var(--auxx-chat-surface-dark-default)] focus:text-[color:var(--auxx-chat-text-loud)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    />
  )
}
