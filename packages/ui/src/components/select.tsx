'use client'

import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { Select as SelectPrimitive } from 'radix-ui'
import type * as React from 'react'

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

// SelectTrigger variants using cva
const selectTriggerVariants = cva(
  'flex w-full items-center justify-between whitespace-nowrap rounded-xl border font-medium text-sm shadow-xs ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-transparent [&>span]:line-clamp-1',
  {
    variants: {
      variant: {
        default:
          'border-primary-200 focus:border-primary-300 bg-primary-50 dark:bg-[#1e2227] dark:border-[#2c313a] focus:ring-primary-400 placeholder:text-primary-500',
        transparent:
          'border-none bg-transparent shadow-none focus:ring-0 focus-visible:ring-0 placeholder:text-muted-foreground',
        ghost: 'shadow-none border-none hover:bg-accent hover:text-accent-foreground',
        outline:
          'border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground focus-visible:ring-blue-500',
      },
      size: { default: 'h-8 px-3', sm: 'h-7 px-2 text-xs', xs: 'h-6 px-2 text-xs' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export interface SelectTriggerProps
  extends React.ComponentProps<typeof SelectPrimitive.Trigger>,
    VariantProps<typeof selectTriggerVariants> {}

function SelectTrigger({ className, children, variant, size, ...props }: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      className={cn(selectTriggerVariants({ variant, size, className }))}
      {...props}>
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className='size-4 opacity-50' />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      className={cn(
        'flex cursor-default items-center justify-center py-1 absolute top-0 w-full  z-10',
        'mask-b-from-50% bg-background',
        'animate-in fade-in duration-300',
        className
      )}
      {...props}>
      <ChevronUp className='size-4' />
    </SelectPrimitive.ScrollUpButton>
  )
}
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      className={cn(
        'flex cursor-default items-center justify-center py-1 absolute bottom-0 w-full z-10',
        'mask-t-from-50% bg-background',
        'animate-in fade-in duration-300',
        className
      )}
      {...props}>
      <ChevronDown className='size-4' />
    </SelectPrimitive.ScrollDownButton>
  )
}
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

function SelectContent({
  className,
  children,
  position = 'item-aligned',
  align = 'center',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          'relative z-50 max-h-96 min-w-32 overflow-hidden rounded-2xl border-transparent bg-popover text-popover-foreground shadow-md shadow-black/10 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className
        )}
        align={align}
        position={position}
        {...props}>
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' &&
              'h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width)'
          )}>
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}
SelectContent.displayName = SelectPrimitive.Content.displayName

// function SelectContent({
//   className,
//   children,
//   position = 'item-aligned',
//   align = 'center',
//   ...props
// }: React.ComponentProps<typeof SelectPrimitive.Content>) {
//   return (
//     <SelectPrimitive.Portal>
//       <SelectPrimitive.Content
//         data-slot="select-content"
//         className={cn(
//           'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md',
//           position === 'popper' &&
//             'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
//           className
//         )}
//         position={position}
//         align={align}
//         {...props}>
//         <SelectScrollUpButton />
//         <SelectPrimitive.Viewport
//           className={cn(
//             'p-1',
//             position === 'popper' &&
//               'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1'
//           )}>
//           {children}
//         </SelectPrimitive.Viewport>
//         <SelectScrollDownButton />
//       </SelectPrimitive.Content>
//     </SelectPrimitive.Portal>
//   )
// }

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn('px-2 py-1.5 text-sm font-semibold', className)}
      {...props}
    />
  )
}
SelectLabel.displayName = SelectPrimitive.Label.displayName

function SelectItem({
  className,
  children,
  description,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & { description?: string }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex w-full cursor-default select-none items-center rounded-2xl  pl-2 py-1 min-h-7 pr-8 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        className
      )}
      {...props}>
      <span className='absolute right-2 flex size-3.5 items-center justify-center'>
        <SelectPrimitive.ItemIndicator>
          <Check className='size-4' />
        </SelectPrimitive.ItemIndicator>
      </span>
      <div className='flex flex-col'>
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {description && <span className='text-xs text-muted-foreground'>{description}</span>}
      </div>
    </SelectPrimitive.Item>
  )
}
SelectItem.displayName = SelectPrimitive.Item.displayName

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-muted', className)} {...props} />
  )
}
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  selectTriggerVariants,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
