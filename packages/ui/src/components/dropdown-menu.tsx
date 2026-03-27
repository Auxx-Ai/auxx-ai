// packages/ui/src/components/dropdown-menu.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { Check, ChevronRight } from 'lucide-react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import type * as React from 'react'
import {
  menuCheckboxItemStyles,
  menuContentStyles,
  menuItemStyles,
  menuLabelStyles,
  menuRadioItemStyles,
  menuSeparatorStyles,
  menuShortcutStyles,
  menuSubContentStyles,
  menuSubTriggerStyles,
  menuVariants,
} from './menu-styles'

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
  variant?: VariantProps<typeof menuVariants>['variant']
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(menuVariants({ variant }), menuSubTriggerStyles, inset && 'pl-8', className)}
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
      className={cn(...menuSubContentStyles, className)}
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
        className={cn(...menuContentStyles, className)}
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
  variant?: VariantProps<typeof menuVariants>['variant']
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(menuVariants({ variant }), menuItemStyles, inset && 'pl-8', className)}
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
  variant?: VariantProps<typeof menuVariants>['variant']
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(menuVariants({ variant }), menuCheckboxItemStyles, className)}
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
  variant?: VariantProps<typeof menuVariants>['variant']
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(menuVariants({ variant }), menuRadioItemStyles, className)}
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
      className={cn(menuLabelStyles, inset && 'pl-8', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator className={cn(menuSeparatorStyles, className)} {...props} />
  )
}

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn(menuShortcutStyles, className)} {...props} />
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
  menuVariants as dropdownVariants,
}
