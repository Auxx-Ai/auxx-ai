'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker } from 'react-day-picker'
// import 'react-day-picker/style.css'

import { cn } from '@auxx/ui/lib/utils'
import { buttonVariants } from '@auxx/ui/components/button'

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3 relative', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-2',
        month: 'flex flex-col gap-4',
        month_caption: 'flex justify-center relative items-center w-full',
        caption_label: 'text-sm font-medium h-6 flex items-center',
        nav: 'flex items-center gap-1',
        button_previous: cn(
          buttonVariants({ variant: 'outline' }),
          'size-7 top-2 bg-transparent p-0 opacity-50 hover:opacity-100 absolute left-2 z-10'
        ),
        button_next: cn(
          buttonVariants({ variant: 'outline' }),
          'size-7 top-2 bg-transparent p-0 opacity-50 hover:opacity-100 absolute right-2 z-10'
        ),
        month_grid: 'w-full border-collapse space-x-1',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]',
        week: 'flex w-full mt-1',
        day: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-8 p-0 font-normal aria-selected:opacity-100'
        ),

        // day: cn(
        //   'relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].range-end)]:rounded-r-md',
        //   props.mode === 'range'
        //     ? '[&:has(>.range-end)]:rounded-r-md [&:has(>.range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md'
        //     : '[&:has([aria-selected])]:rounded-md'
        // ),
        day_button: cn(
          // buttonVariants({ variant: 'ghost' }),
          'size-8 p-0 font-normal aria-selected:opacity-100'
        ),
        range_start:
          'range-start rounded-l-md rounded-r-none aria-selected:bg-primary-200 aria-selected:text-primary-400',
        range_end:
          'range-end rounded-l-none rounded-r-md aria-selected:bg-primary-200 aria-selected:text-primary-400',
        selected:
          'bg-info text-white hover:bg-info! hover:text-primary-foreground focus:bg-info focus:text-primary-foreground',
        today: 'rounded-lg bg-accent-100 font-semibold text-info hover:bg-accent-200',
        outside: 'outside text-primary-300 aria-selected:text-muted-foreground',
        disabled: 'text-muted-foreground opacity-50',
        range_middle: 'rounded-none aria-selected:bg-accent aria-selected:text-accent-foreground',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        IconLeft: ({ className, ...props }) => (
          <ChevronLeft className={cn('size-4', className)} {...props} />
        ),
        IconRight: ({ className, ...props }) => (
          <ChevronRight className={cn('size-4', className)} {...props} />
        ),
      }}
      {...props}
    />
  )
}

export { Calendar }
