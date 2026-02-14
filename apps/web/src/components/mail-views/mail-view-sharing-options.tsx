'use client'

// components/mail-views/MailViewSharingOptions.tsx

import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@auxx/ui/components/form'
import { useFormContext } from 'react-hook-form'
import type { MailViewFormValues } from './mail-view-dialog'

export function MailViewSharingOptions() {
  const { control } = useFormContext<MailViewFormValues>()

  return (
    <div className='space-y-4 flex items-center gap-4 rounded-md border bg-muted/30 p-3'>
      <FormField
        control={control}
        name='isShared'
        render={({ field }) => (
          <FormItem className='flex flex-row items-center space-x-3 space-y-0'>
            <FormControl>
              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <div className='space-y-2 leading-none flex flex-col'>
              <FormLabel>Share with organization</FormLabel>
              <FormDescription>
                Make this view available to all members of your organization
              </FormDescription>
            </div>
          </FormItem>
        )}
      />
    </div>
  )
}
