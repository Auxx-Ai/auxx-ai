'use client'

import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronRight, Circle } from 'lucide-react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import type * as React from 'react'

const dropdownVariants = cva('', {
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

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  variant,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
  variant?: VariantProps<typeof dropdownVariants>['variant']
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        dropdownVariants({ variant }),
        'flex cursor-default select-none items-center gap-2 rounded-full px-2 py-1 text-sm outline-hidden data-[state=open]:bg-accent/50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        inset && 'pl-8',
        className
      )}
      {...props}>
      {children}
      <ChevronRight className='ml-auto' />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      className={cn(
        'z-50 min-w-32 overflow-hidden rounded-2xl border border-foreground/15 bg-popover/70 p-1 text-popover-foreground shadow-sm shadow-black/10 dark:shadow-black/50  inset-shadow-2xs inset-shadow-white/25 backdrop-blur-lg',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className
      )}
      {...props}
    />
  )
}

// <div className="bg-illustration ring-border-illustration relative w-56 overflow-hidden rounded-2xl p-1 shadow-xl shadow-black/10 ring-1 *:cursor-pointer *:rounded-xl">

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-32 rounded-2xl border border-foreground/15 dark:border-popover bg-popover/70 p-1 text-popover-foreground shadow-sm shadow-black/10 dark:shadow-black/50  inset-shadow-2xs inset-shadow-white/25 backdrop-blur-lg ',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: VariantProps<typeof dropdownVariants>['variant']
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        dropdownVariants({ variant }),
        'relative flex cursor-default select-none items-center gap-2 rounded-2xl px-2 py-1 text-sm outline-hidden transition-colors data-disabled:pointer-events-none data-disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
        inset && 'pl-8',
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  variant,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  variant?: VariantProps<typeof dropdownVariants>['variant']
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        dropdownVariants({ variant }),
        'relative flex cursor-default select-none items-center rounded-full py-1 pl-8 pr-2 text-sm outline-hidden transition-colors data-disabled:pointer-events-none data-disabled:opacity-50',
        className
      )}
      checked={checked}
      {...props}>
      <span className='absolute left-2 flex h-3.5 w-3.5 items-center justify-center'>
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className='h-4 w-4' />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  variant,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  variant?: VariantProps<typeof dropdownVariants>['variant']
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        dropdownVariants({ variant }),
        'relative flex cursor-default select-none items-center rounded-full py-1 pl-8 pr-2 text-sm outline-hidden transition-colors data-disabled:pointer-events-none data-disabled:opacity-50',
        className
      )}
      {...props}>
      {children}
      <span className='absolute right-2 flex h-3.5 w-3.5 items-center justify-center'>
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className='h-5 w-5' />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('px-2 py-1.5 text-sm font-semibold', inset && 'pl-8', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-foreground/5', className)}
      {...props}
    />
  )
}

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn('ml-auto text-xs tracking-widest opacity-60', className)} {...props} />
}
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut'

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  dropdownVariants,
}
