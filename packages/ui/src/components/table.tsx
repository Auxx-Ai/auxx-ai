import { cn } from '@auxx/ui/lib/utils'
import type * as React from 'react'

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className='relative w-full overflow-auto'>
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}
Table.displayName = 'Table'

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />
}
TableHeader.displayName = 'TableHeader'

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}
TableBody.displayName = 'TableBody'

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      className={cn('border-t bg-muted/50 font-medium last:[&>tr]:border-b-0', className)}
      {...props}
    />
  )
}
TableFooter.displayName = 'TableFooter'

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className
      )}
      {...props}
    />
  )
}
TableRow.displayName = 'TableRow'

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className
      )}
      {...props}
    />
  )
}
TableHead.displayName = 'TableHead'

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      className={cn(
        'p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className
      )}
      {...props}
    />
  )
}
TableCell.displayName = 'TableCell'

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return <caption className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
}
TableCaption.displayName = 'TableCaption'

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
