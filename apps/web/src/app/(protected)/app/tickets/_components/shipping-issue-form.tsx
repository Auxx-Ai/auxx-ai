// components/tickets/ticket-forms/shipping-issue-form.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Calendar } from '@auxx/ui/components/calendar'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Textarea } from '@auxx/ui/components/textarea'
import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'

interface ShippingIssueFormProps {
  form: UseFormReturn<any>
}

export function ShippingIssueForm({ form }: ShippingIssueFormProps) {
  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        <FormField
          control={form.control}
          name='orderId'
          render={({ field }) => (
            <FormItem className='flex flex-col'>
              <FormLabel>Order ID</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='orderDate'
          render={({ field }) => (
            <FormItem className='flex flex-col'>
              <FormLabel>Order Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant={'outline-solid'}
                      className={`w-full pl-3 text-left font-normal ${
                        !field.value ? 'text-muted-foreground' : ''
                      }`}>
                      {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                      <CalendarIcon className='ml-auto h-4 w-4 opacity-50' />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className='w-auto p-0' align='start'>
                  <Calendar
                    mode='single'
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => date > new Date(new Date().setHours(23, 59, 59, 999))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        <FormField
          control={form.control}
          name='trackingNumber'
          render={({ field }) => (
            <FormItem className='flex flex-col'>
              <FormLabel>Tracking Number (Optional)</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='carrier'
          render={({ field }) => (
            <FormItem className='flex flex-col'>
              <FormLabel>Carrier (Optional)</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name='issue'
        render={({ field }) => (
          <FormItem className='flex flex-col'>
            <FormLabel>Shipping Issue Description</FormLabel>
            <FormControl>
              <Textarea
                placeholder='Describe the shipping issue'
                className='min-h-[80px]'
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}
