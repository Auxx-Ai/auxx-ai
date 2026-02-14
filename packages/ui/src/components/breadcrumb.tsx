import { cn } from '@auxx/ui/lib/utils'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import { Slot as SlotPrimitive } from 'radix-ui'
import type * as React from 'react'

function Breadcrumb({ ...props }: React.ComponentProps<'nav'> & { separator?: React.ReactNode }) {
  return <nav aria-label='breadcrumb' {...props} />
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<'ol'>) {
  return (
    <ol
      className={cn(
        'flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5',
        className
      )}
      {...props}
    />
  )
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li className={cn('inline-flex items-center gap-1.5', className)} {...props} />
}

function BreadcrumbLink({
  asChild,
  className,
  ...props
}: React.ComponentProps<'a'> & { asChild?: boolean }) {
  const Comp = asChild ? SlotPrimitive.Slot : 'a'

  return <Comp className={cn('transition-colors hover:text-foreground', className)} {...props} />
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      role='link'
      aria-disabled='true'
      aria-current='page'
      className={cn('font-normal text-foreground', className)}
      {...props}
    />
  )
}

function BreadcrumbSeparator({ children, className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      role='presentation'
      aria-hidden='true'
      className={cn('[&>svg]:w-3.5 [&>svg]:h-3.5', className)}
      {...props}>
      {children ?? <ChevronRight />}
    </li>
  )
}

function BreadcrumbEllipsis({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      role='presentation'
      aria-hidden='true'
      className={cn('flex h-9 w-9 items-center justify-center', className)}
      {...props}>
      <MoreHorizontal className='h-4 w-4' />
      <span className='sr-only'>More</span>
    </span>
  )
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
}
