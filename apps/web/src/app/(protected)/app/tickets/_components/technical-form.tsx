// components/tickets/ticket-forms/technical-form.tsx
'use client'

import { UseFormReturn } from 'react-hook-form'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'

interface TechnicalFormProps {
  form: UseFormReturn<any>
}

export function TechnicalForm({ form }: TechnicalFormProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={form.control}
          name="deviceInfo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Device Information (Optional)</FormLabel>
              <FormControl>
                <Input placeholder="Device type, model, OS version, etc." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="browserInfo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Browser Information (Optional)</FormLabel>
              <FormControl>
                <Input placeholder="Browser name, version, etc." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="errorMessage"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Error Message (Optional)</FormLabel>
            <FormControl>
              <Textarea
                placeholder="Exact error message displayed"
                className="min-h-[80px]"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="stepsToReproduce"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Steps to Reproduce (Optional)</FormLabel>
            <FormControl>
              <Textarea
                placeholder="Detailed steps to reproduce the issue"
                className="min-h-[100px]"
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
