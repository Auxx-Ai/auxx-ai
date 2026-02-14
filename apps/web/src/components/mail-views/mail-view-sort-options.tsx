// components/mail-views/MailViewSortOptions.tsx
'use client'

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@auxx/ui/components/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { useFormContext } from 'react-hook-form'
import type { MailViewFormValues } from './mail-view-dialog'

export function MailViewSortOptions() {
  const { control } = useFormContext<MailViewFormValues>()

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-2 gap-4'>
        <FormField
          control={control}
          name='sortField'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Sort By</FormLabel>
              <FormControl>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder='Select field' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='lastMessageAt'>Date</SelectItem>
                    <SelectItem value='subject'>Subject</SelectItem>
                    <SelectItem value='participantIds'>Participants</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormDescription>Field to sort threads by</FormDescription>
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name='sortDirection'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Direction</FormLabel>
              <FormControl>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder='Select direction' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='desc'>Newest first</SelectItem>
                    <SelectItem value='asc'>Oldest first</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormDescription>Sort direction</FormDescription>
            </FormItem>
          )}
        />
      </div>
    </div>
  )
}
