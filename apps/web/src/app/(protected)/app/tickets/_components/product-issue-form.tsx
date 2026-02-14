// components/tickets/ticket-forms/product-issue-form.tsx
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

interface ProductIssueFormProps {
  form: UseFormReturn<any>
}

export function ProductIssueForm({ form }: ProductIssueFormProps) {
  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        <FormField
          control={form.control}
          name='productId'
          render={({ field }) => (
            <FormItem className='flex flex-col'>
              <FormLabel>Product ID</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name='purchaseDate'
          render={({ field }) => (
            <FormItem className='flex flex-col'>
              <FormLabel>Purchase Date (Optional)</FormLabel>
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

      <FormField
        control={form.control}
        name='orderId'
        render={({ field }) => (
          <FormItem>
            <FormLabel>Order ID (Optional)</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name='issueDescription'
        render={({ field }) => (
          <FormItem>
            <FormLabel>Issue Description</FormLabel>
            <FormControl>
              <Textarea
                placeholder='Describe the product issue in detail'
                className='min-h-[100px]'
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Could implement file uploading for product images here */}
    </div>
  )
}
