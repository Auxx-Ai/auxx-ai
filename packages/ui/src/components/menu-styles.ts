// packages/ui/src/components/menu-styles.ts

import { cva } from 'class-variance-authority'

export const menuVariants = cva('', {
  variants: {
    variant: {
      default: 'focus:bg-accent/50 focus:text-accent-foreground',
      destructive: 'text-bad-500 focus:bg-bad-50 focus:text-bad-500',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export const menuContentStyles = [
  'z-50 min-w-32 rounded-2xl border border-foreground/15 dark:border-popover bg-popover/70 p-1 text-popover-foreground shadow-sm shadow-black/10 dark:shadow-black/50  inset-shadow-2xs inset-shadow-white/25 backdrop-blur-lg',
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
] as const

export const menuSubContentStyles = [
  'z-50 min-w-32 overflow-hidden rounded-2xl border border-foreground/15 bg-popover/70 p-1 text-popover-foreground shadow-sm shadow-black/10 dark:shadow-black/50  inset-shadow-2xs inset-shadow-white/25 backdrop-blur-lg',
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
] as const

export const menuSubTriggerStyles =
  'flex cursor-default select-none items-center gap-2 rounded-full px-2 py-1 text-sm outline-hidden data-[state=open]:bg-accent/50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'

export const menuItemStyles =
  'relative flex cursor-default select-none items-center gap-2 rounded-2xl px-2 py-1 text-sm outline-hidden transition-colors data-disabled:pointer-events-none data-disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0'

export const menuCheckboxItemStyles =
  'relative flex cursor-default select-none items-center rounded-full py-1 pl-8 pr-2 text-sm outline-hidden transition-colors data-disabled:pointer-events-none data-disabled:opacity-50'

export const menuRadioItemStyles =
  'relative flex cursor-default select-none items-center rounded-full py-1 pl-8 pr-2 text-sm outline-hidden transition-colors data-disabled:pointer-events-none data-disabled:opacity-50'

export const menuLabelStyles = 'px-2 py-1.5 text-sm font-semibold'

export const menuSeparatorStyles = '-mx-1 my-1 h-px bg-foreground/5'

export const menuShortcutStyles = 'ml-auto text-xs tracking-widest opacity-60'
