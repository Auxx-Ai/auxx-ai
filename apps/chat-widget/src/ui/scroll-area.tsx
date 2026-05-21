// apps/chat-widget/src/ui/scroll-area.tsx

import type { ComponentProps } from 'preact/compat'
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui'
import { cn } from '~/lib/cn'

export function ScrollArea({
  className,
  children,
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport className='h-full w-full rounded-[inherit]'>
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation='vertical'
        className='flex w-2 touch-none select-none transition-colors'>
        <ScrollAreaPrimitive.Thumb className='relative flex-1 rounded-full bg-[color:var(--color-border)]' />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
