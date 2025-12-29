// components/tickets/ticket-forms/refund-form.tsx
'use client'

import { UseFormReturn } from 'react-hook-form'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Button } from '@auxx/ui/components/button'
import { Calendar } from '@auxx/ui/components/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { CalendarIcon } from 'lucide-react'
import { format } from 'date-fns'

interface RefundFormProps {
  form: UseFormReturn<any>
}

export function RefundForm({ form }: RefundFormProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={form.control}
          name="orderId"
          render={({ field }) => (
            <FormItem className="flex flex-col">
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
          name="orderDate"
          render={({ field }) => (
            <FormItem className="flex flex-col">
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
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={form.control}
          name="refundAmount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Refund Amount</FormLabel>
              <FormControl>
                <Input type="number" min="0.01" step="0.01" placeholder="0.00" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="refundReason"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Refund Reason</FormLabel>
            <FormControl>
              <Textarea
                placeholder="Reason for the refund request"
                className="min-h-[80px]"
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
