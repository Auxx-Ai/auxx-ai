// packages/ui/src/components/context-menu.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { Check, ChevronRight } from 'lucide-react'
import { Checkbox as CheckboxPrimitive, ContextMenu as ContextMenuPrimitive } from 'radix-ui'
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

const ContextMenu = ContextMenuPrimitive.Root

const ContextMenuTrigger = ContextMenuPrimitive.Trigger

const ContextMenuGroup = ContextMenuPrimitive.Group

const ContextMenuPortal = ContextMenuPrimitive.Portal

const ContextMenuSub = ContextMenuPrimitive.Sub

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  variant,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean
  variant?: VariantProps<typeof menuVariants>['variant']
}) {
  return (
    <ContextMenuPrimitive.SubTrigger
      className={cn(menuVariants({ variant }), menuSubTriggerStyles, inset && 'pl-8', className)}
      {...props}>
      {children}
      <ChevronRight className='ml-auto' />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.SubContent
      className={cn(...menuSubContentStyles, className)}
      {...props}
    />
  )
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content className={cn(...menuContentStyles, className)} {...props} />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  variant?: VariantProps<typeof menuVariants>['variant']
}) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(menuVariants({ variant }), menuItemStyles, inset && 'pl-8', className)}
      {...props}
    />
  )
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  variant,
  multi = true,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem> & {
  variant?: VariantProps<typeof menuVariants>['variant']
  multi?: boolean
}) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      className={cn(
        menuVariants({ variant }),
        'relative flex cursor-default select-none items-center rounded-full py-1 px-2 text-sm outline-hidden transition-colors data-disabled:pointer-events-none data-disabled:opacity-50',
        className
      )}
      checked={checked}
      {...props}>
      <div className='flex w-full items-center justify-between'>
        <div className='flex items-center gap-2'>{children}</div>
        <div className='flex items-center justify-center'>
          {multi ? (
            <CheckboxPrimitive.Root
              checked={checked}
              className='pointer-events-none peer h-4 w-4 shrink-0 rounded-sm border border-primary-300 shadow-sm disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-info data-[state=checked]:text-primary-foreground data-[state=checked]:dark:text-white data-[state=checked]:border-blue-800'>
              <CheckboxPrimitive.Indicator className='flex items-center justify-center text-current'>
                <Check className='size-2.5!' strokeWidth={4} />
              </CheckboxPrimitive.Indicator>
            </CheckboxPrimitive.Root>
          ) : (
            checked && (
              <div className='flex size-4 items-center justify-center rounded-full border border-blue-800 bg-info'>
                <Check className='size-2.5! text-white' strokeWidth={4} />
              </div>
            )
          )}
        </div>
      </div>
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioItem({
  className,
  children,
  variant,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem> & {
  variant?: VariantProps<typeof menuVariants>['variant']
}) {
  return (
    <ContextMenuPrimitive.RadioItem
      className={cn(menuVariants({ variant }), menuRadioItemStyles, className)}
      {...props}>
      {children}
      <span className='absolute right-2 flex h-3.5 w-3.5 items-center justify-center'>
        <ContextMenuPrimitive.ItemIndicator>
          <Check className='h-5 w-5' />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
    </ContextMenuPrimitive.RadioItem>
  )
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <ContextMenuPrimitive.Label
      className={cn(menuLabelStyles, inset && 'pl-8', className)}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator className={cn(menuSeparatorStyles, className)} {...props} />
  )
}

const ContextMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn(menuShortcutStyles, className)} {...props} />
}
ContextMenuShortcut.displayName = 'ContextMenuShortcut'

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
