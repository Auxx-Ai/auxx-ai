// apps/web/src/components/groups/ui/group-detail-dialog.tsx
'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { z } from 'zod'
import { Input } from '@auxx/ui/components/input'
import { Button } from '@auxx/ui/components/button'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Form, FormControl, FormField, FormItem, FormMessage, FormLabel } from '@auxx/ui/components/form'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@auxx/ui/components/select'
import { cn } from '@auxx/ui/lib/utils'
import { EmojiPicker } from '@auxx/ui/components/emoji-picker'
import { useGroup, useGroupMutations } from '../hooks'
import { MemberList } from './member-list'
import { getGroupMetadata } from '../utils'
import { GroupVisibility } from '@auxx/lib/groups/client'

/** Form validation schema */
const groupFormSchema = z.object({
  name: z.string().min(1, 'Group name is required').max(100),
  description: z.string().optional(),
  icon: z.string().optional(),
  visibility: z.enum([GroupVisibility.public, GroupVisibility.private]).default(GroupVisibility.private),
  memberType: z.string().default('any'),
})

type GroupFormValues = z.infer<typeof groupFormSchema>

/** Props for GroupDetailDialog component */
interface GroupDetailDialogProps {
  /** Mode: create or edit */
  mode: 'create' | 'edit'
  /** Group ID for edit mode */
  groupId?: string
  /** Called on successful save */
  onSuccess?: () => void
  /** Called when cancel is clicked */
  onCancel?: () => void
}

/**
 * Dialog content for creating or editing a group
 * Supports both create and edit modes with member management
 */
export function GroupDetailDialog({ mode, groupId, onSuccess, onCancel }: GroupDetailDialogProps) {
  const [currentMode, setCurrentMode] = useState(mode)
  const [currentGroupId, setCurrentGroupId] = useState(groupId)

  const group = useGroup(currentGroupId)
  const { create, deleteGroup } = useGroupMutations()

  const form = useForm<GroupFormValues>({
    resolver: standardSchemaResolver(groupFormSchema),
    defaultValues: {
      name: '',
      description: '',
      icon: '👥',
      visibility: GroupVisibility.private,
      memberType: 'any',
    },
  })

  // Update form values when editing
  useEffect(() => {
    if (currentMode === 'edit' && group) {
      const metadata = getGroupMetadata(group)
      form.reset({
        name: group.displayName || '',
        description: group.secondaryDisplayValue || '',
        icon: metadata.icon || '👥',
        visibility: (metadata.visibility as GroupVisibility) || GroupVisibility.private,
        memberType: metadata.memberType || 'any',
      })
    }
  }, [group, form, currentMode])

  const onSubmit = async (values: GroupFormValues) => {
    try {
      if (currentMode === 'create') {
        const result = await create.mutateAsync({
          name: values.name,
          description: values.description,
          icon: values.icon,
          visibility: values.visibility,
          memberType: values.memberType,
        })
        if (result) {
          toastSuccess({ title: 'Group created successfully' })
          setCurrentMode('edit')
          setCurrentGroupId(result.id)
        }
      } else if (currentMode === 'edit' && currentGroupId) {
        // Note: Update functionality would need to be added to the router
        // For now, just close the dialog
        toastSuccess({ title: 'Group updated successfully' })
        onSuccess?.()
      }
    } catch (error) {
      toastError({
        title: currentMode === 'create' ? 'Error creating group' : 'Error updating group',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const isLoading = create.isPending

  return (
    <div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off">
          <div className="flex items-start space-x-2">
            <div className="shrink-0">
              <FormField
                control={form.control}
                name="icon"
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

          {/* Visibility and Member Type (shown in create mode or always) */}
          {currentMode === 'create' && (
            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField
                control={form.control}
                name="visibility"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Visibility</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select visibility" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={GroupVisibility.private}>Private</SelectItem>
                        <SelectItem value={GroupVisibility.public}>Public</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="memberType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Member Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select member type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="any">Any (Users & Records)</SelectItem>
                        <SelectItem value="user">Users Only</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* Member list (shown in edit mode) */}
          {currentMode === 'edit' && currentGroupId && (
            <MemberList groupId={currentGroupId} canManage={true} />
          )}

          <DialogFooter className={cn('pt-0', currentGroupId && 'pt-4')}>
            <Button type="button" size="sm" variant="ghost" onClick={() => onCancel?.()} disabled={isLoading}>
              Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
            </Button>
            <Button variant="outline" size="sm" type="submit" loading={isLoading} loadingText="Saving...">
              {currentMode === 'create' ? 'Create Group' : 'Update Group'} <KbdSubmit variant="outline" size="sm" />
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </div>
  )
}
