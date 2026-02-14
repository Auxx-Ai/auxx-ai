// components/mail/mail-views/mail-view-details-form.tsx
'use client'

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { useFormContext } from 'react-hook-form'
import type { MailViewFormValues } from './mail-view-dialog'

export function MailViewDetailsForm() {
  const { control } = useFormContext<MailViewFormValues>()

  return (
    <div className='space-y-4'>
      <FormField
        control={control}
        name='name'
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input placeholder='My Mail View' {...field} />
            </FormControl>
            <FormDescription>A name to identify this view</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name='description'
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea placeholder='Optional description...' {...field} />
            </FormControl>
            <FormDescription>Briefly describe what this view shows</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* <div className='flex flex-col space-y-2'>
        <FormField
          control={control}
          name='isPinned'
          render={({ field }) => (
            <FormItem className='flex flex-row items-start space-x-3 space-y-0'>
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className='space-y-1 leading-none'>
                <FormLabel>Pin this view</FormLabel>
                <FormDescription>
                  Pinned views appear at the top of your view list
                </FormDescription>
              </div>
            </FormItem>
          )}
        /> */}
      {/* 
        <FormField
          control={control}
          name='isDefault'
          render={({ field }) => (
            <FormItem className='flex flex-row items-start space-x-3 space-y-0'>
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className='space-y-1 leading-none'>
                <FormLabel>Set as default view</FormLabel>
                <FormDescription>
                  This view will load automatically when you open your inbox
                </FormDescription>
              </div>
            </FormItem>
          )}
        /> 
      </div>*/}
    </div>
  )
}
