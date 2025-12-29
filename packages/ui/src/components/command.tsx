'use client'

import * as React from 'react'
import { type DialogProps } from 'radix-ui'
import { Command as CommandPrimitive } from 'cmdk'
import { Search, X } from 'lucide-react'

import { cn } from '@auxx/ui/lib/utils'
import { Dialog, DialogContent } from '@auxx/ui/components/dialog'

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-2xl text-popover-foreground',
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({ children, ...props }: DialogProps & { children?: React.ReactNode }) {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  onValueChange,
  value,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  const resetInput = React.useCallback(() => {
    onValueChange?.('')
  }, [onValueChange])
  return (
    <div className="flex items-center border-b border-border/50 ps-3 pe-1" cmdk-input-wrapper="">
      <Search className="mr-2 size-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        className={cn(
          'flex h-8 w-full rounded-md bg-transparent py-1 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        onValueChange={onValueChange}
        value={value}
        {...props}
      />
      {value && (
        <a
          onClick={resetInput}
          className="rounded-full cursor-default flex items-center justify-center hover:bg-bad-100 hover:text-bad-500 size-5 bg-primary-100 shrink-0 ">
          <X className="size-3" />
        </a>
      )}
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-[300px] overflow-y-auto overflow-x-hidden', className)}
      {...props}
    />
  )
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className="relative flex cursor-default select-none items-center gap-2 rounded-full px-3 py-2 text-sm outline-hidden text-primary-400"
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator className={cn('-mx-1 h-px bg-border/50', className)} {...props} />
  )
}
//removed per https://github.com/pacocoursey/cmdk/issues/244: data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50
function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-full px-2 py-1 text-sm outline-hidden data-[selected=true]:ring-border-illustration  data-[selected=true]:ring-1 data-[selected=true]:bg-accent/50 data-[selected=true]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  )
}

function CommandShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
