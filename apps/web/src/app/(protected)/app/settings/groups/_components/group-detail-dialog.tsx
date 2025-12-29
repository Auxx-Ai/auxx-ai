// /app/(protected)/app/settings/groups/_components/group-detail-dialog.tsx
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { z } from 'zod'
import { api } from '~/trpc/react'
import { Input } from '@auxx/ui/components/input'
import { Button } from '@auxx/ui/components/button'
import { MemberList } from './member-list' // We'll implement this next
import { toast } from 'sonner'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@auxx/ui/components/form'
import { EmojiPicker } from '~/components/pickers/emoji-picker'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { cn } from '@auxx/ui/lib/utils'

const groupFormSchema = z.object({
  name: z.string().min(1, 'Group name is required').max(100),
  description: z.string().optional(),
  emoji: z.string().optional(),
  color: z.string().optional(),
})

type GroupFormValues = z.infer<typeof groupFormSchema>

interface GroupDetailDialogProps {
  mode: 'create' | 'edit'
  groupId?: string
  onSuccess?: () => void
  onCancel?: () => void
}

export function GroupDetailDialog({ mode, groupId, onSuccess, onCancel }: GroupDetailDialogProps) {
  const utils = api.useUtils()
  const [currentMode, setCurrentMode] = useState(mode)
  const [currentGroupId, setCurrentGroupId] = useState(groupId)
  // Get group data for edit mode
  const { data: groupData, isLoading: isLoadingGroup } = api.group.byId.useQuery(
    { id: currentGroupId! },
    { enabled: currentMode === 'edit' && !!currentGroupId }
  )

  // Create and update mutations
  const createMutation = api.group.create.useMutation({
    onSuccess: () => {},
    onError: (error) => {
      toast.error(`Error creating group: ${error.message}`)
    },
  })

  const updateMutation = api.group.update.useMutation({
    onSuccess: () => {},
    onError: (error) => {
      toast.error(`Error updating group: ${error.message}`)
    },
  })

  // Setup form
  const form = useForm<GroupFormValues>({
    resolver: standardSchemaResolver(groupFormSchema),
    defaultValues: { name: '', description: '', emoji: '👥', color: '#4f46e5' },
  })

  // Update form values when editing
  useEffect(() => {
    if (currentMode === 'edit' && groupData?.group) {
      const group = groupData.group
      const properties = (group.properties as Record<string, any>) || {}

      form.reset({
        name: group.name,
        description: group.description || '',
        emoji: properties.emoji || '👥',
      })
    }
  }, [groupData, form, currentMode])

  const onSubmit = async (values: GroupFormValues) => {
    if (currentMode === 'create') {
      const result = await createMutation.mutateAsync(values)
      if (result) {
        toast.success('Group created successfully')
        setCurrentMode('edit')
        setCurrentGroupId(result.group!.id)
      }
    } else if (currentMode === 'edit' && currentGroupId) {
      updateMutation.mutateAsync({ id: currentGroupId, ...values })
      toast.success('Group updated successfully')
      onSuccess?.()
    }
    await utils.group.all.invalidate() // Refresh group list
  }

  const isLoading = isLoadingGroup || createMutation.isPending || updateMutation.isPending

  return (
    <div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="" autoComplete="off">
          <div className="flex items-start space-x-2">
            <div className="shrink-0">
              <FormField
                control={form.control}
                name="emoji"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <EmojiPicker
                        className="mt-0.5 size-8 rounded-full text-base"
                        value={field.value || '👥'}
                        onChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="grow">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="mt-0 space-y-0">
                    <FormControl>
                      <Input
                        className="border-0 p-0 shadow-none focus-visible:ring-0 md:text-lg"
                        placeholder="Group name..."
                        variant="transparent"
                        {...field}
                        disabled={isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="mt-0 space-y-0 mb-2">
                    <FormControl>
                      <Input
                        variant="transparent"
                        placeholder="Group description..."
                        className="border-0 p-0 shadow-none focus-visible:ring-0"
                        {...field}
                        disabled={isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
          {currentMode === 'edit' && currentGroupId && <MemberList groupId={currentGroupId} />}

          <DialogFooter className={cn('pt-0', currentGroupId && 'pt-4')}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onCancel?.()}
              disabled={isLoading}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="submit"
              loading={isLoading}
              loadingText="Saving...">
              {currentMode === 'create' ? 'Create Group' : 'Update Group'}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </div>
  )
}
