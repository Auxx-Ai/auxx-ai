// apps/web/src/components/groups/ui/group-general-section.tsx
'use client'

import type { EntityInstanceEntity } from '@auxx/database'
import { Button } from '@auxx/ui/components/button'
import { EmojiPicker } from '@auxx/ui/components/emoji-picker'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Settings2 } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { SettingsSection } from '~/components/global/settings-page'
import { useGroupMutations } from '../hooks'
import { getGroupMetadata } from '../utils'

const groupGeneralSchema = z.object({
  name: z.string().min(1, 'Group name is required').max(100),
  description: z.string().optional(),
  icon: z.string().optional(),
})

type GroupGeneralValues = z.infer<typeof groupGeneralSchema>

/**
 * General settings for a group — edit name, description, and icon (emoji) with an
 * explicit "Update group" submit, modelled on `edit-organization-settings.tsx`. The
 * emoji picker sits inline, left of the name. Visibility is set at creation only.
 */
export function GroupGeneralSection({ group }: { group: EntityInstanceEntity }) {
  const { update } = useGroupMutations()
  const meta = getGroupMetadata(group)

  const form = useForm<GroupGeneralValues>({
    resolver: standardSchemaResolver(groupGeneralSchema),
    defaultValues: { name: '', description: '', icon: '👥' },
    mode: 'onChange',
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: form.reset is stable
  useEffect(() => {
    form.reset({
      name: group.displayName || '',
      description: group.secondaryDisplayValue || '',
      icon: meta.icon || '👥',
    })
  }, [group.id, group.displayName, group.secondaryDisplayValue, meta.icon])

  async function onSubmit(values: GroupGeneralValues) {
    try {
      await update.mutateAsync({
        groupId: group.id,
        name: values.name,
        description: values.description,
        icon: values.icon,
      })
    } catch (error) {
      toastError({ title: 'Failed to update group', description: (error as Error).message })
    }
  }

  return (
    <SettingsSection icon={Settings2} title='General'>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className='flex flex-col gap-4 md:flex-row md:items-end'>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem className='flex-1'>
                  <FormLabel>Name</FormLabel>
                  <div className='flex items-center gap-2'>
                    <FormField
                      control={form.control}
                      name='icon'
                      render={({ field: iconField }) => (
                        <EmojiPicker
                          className='size-9 shrink-0 rounded-md text-base'
                          value={iconField.value || '👥'}
                          onChange={iconField.onChange}
                        />
                      )}
                    />
                    <FormControl>
                      <Input placeholder='Group name' {...field} />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem className='flex-1'>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder='What is this group for?' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type='submit'
              size='sm'
              variant='outline'
              className='shrink-0'
              loading={update.isPending}
              loadingText='Updating...'>
              Update group
            </Button>
          </div>
        </form>
      </Form>
    </SettingsSection>
  )
}
