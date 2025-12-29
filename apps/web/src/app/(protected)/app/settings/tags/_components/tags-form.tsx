// components/tags/tag-form-dialog.tsx
'use client'

import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@auxx/ui/components/dialog'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
// import { ColorPicker } from '@auxx/ui/components/color-picker'
import { FormEmojiPicker } from '~/components/pickers/emoji-picker'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import React, { useEffect } from 'react'
import { Loader2, Tag } from 'lucide-react'
import { FormColorTagPicker } from '~/components/pickers/color-tag-picker'

// Schema for tag form validation
const tagFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional().nullable(),
  emoji: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
})

type TagFormValues = z.infer<typeof tagFormSchema>

interface TagFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingTag?: {
    id: string
    title: string
    description?: string | null
    emoji?: string | null
    color?: string | null
    parentId?: string | null
  } | null
  onSuccess?: () => void
}

export function TagFormDialog({
  open,
  onOpenChange,
  editingTag = null,
  onSuccess,
}: TagFormDialogProps) {
  const isEditing = !!editingTag

  // Fetch tags for parent selection dropdown
  const { data: tags, isLoading: isLoadingTags } = api.tag.getHierarchy.useQuery()

  // Form setup with react-hook-form and zod validation
  const form = useForm<TagFormValues>({
    resolver: standardSchemaResolver(tagFormSchema),
    defaultValues: {
      title: '',
      description: '',
      emoji: '',
      color: '#94a3b8', // Default slate color
      parentId: undefined,
    },
  })

  // Set form values when editing an existing tag
  useEffect(() => {
    if (editingTag) {
      form.reset({
        title: editingTag.title,
        description: editingTag.description || '',
        emoji: editingTag.emoji || '',
        color: editingTag.color || '#94a3b8',
        parentId: editingTag.parentId || undefined,
      })
    } else {
      form.reset({ title: '', description: '', emoji: '', color: '#94a3b8', parentId: undefined })
    }
  }, [editingTag, form])

  // Create/update mutations
  const createTag = api.tag.create.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Tag created', description: 'The tag was created successfully' })
      form.reset()
      onOpenChange(false)
      onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to create tag', description: error.message })
    },
  })

  const updateTag = api.tag.update.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Tag updated', description: 'The tag was updated successfully' })
      onOpenChange(false)
      onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update tag', description: error.message })
    },
  })

  // Form submission handler
  function onSubmit(values: TagFormValues) {
    if (values.parentId === 'root') {
      values.parentId = null
    }
    if (isEditing && editingTag) {
      updateTag.mutate({ id: editingTag.id, ...values })
    } else {
      createTag.mutate(values)
    }
  }

  // Loading state
  const isSubmitting = createTag.isPending || updateTag.isPending

  // Recursive function to render tag options with proper indentation
  const renderTagOptions = (tags: any[], depth = 0, path: string[] = [], excludeId?: string) => {
    if (!tags) return null

    return tags.map((tag) => {
      // Skip the current tag and its children when editing to prevent circular references
      if (excludeId && tag.id === excludeId) return null

      const fullPath = [...path, tag.title]
      const indentation = '—'.repeat(depth)
      const prefix = depth > 0 ? `${indentation} ` : ''
      // console.log(tag, tag.id)
      return (
        <React.Fragment key={tag.id}>
          <SelectItem value={tag.id}>
            {prefix}
            {tag.title}
          </SelectItem>
          {tag.children &&
            tag.children.length > 0 &&
            renderTagOptions(tag.children, depth + 1, fullPath, excludeId)}
        </React.Fragment>
      )
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" position="tc">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Tag' : 'Create New Tag'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update this tag's details below."
              : 'Fill out the form below to create a new tag.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="space-y-4">
              {/* Title field */}
              <div className="grid w-full grid-cols-[38px_auto] items-center justify-items-start gap-x-0">
                <div className="">
                  <FormField
                    control={form.control}
                    name="emoji"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <FormEmojiPicker value={field.value || ''} onChange={field.onChange} modal={false}>
                            <Button variant="outline" size="icon" className="mt-px rounded-full">
                              {field.value || <Tag />}
                            </Button>
                          </FormEmojiPicker>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <div className="w-full">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder="Tag name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Description field */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        placeholder="Optional description"
                        className="h-20 resize-none"
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormDescription>Brief description of this tag's purpose</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Color field */}
              <FormField
                control={form.control}
                name="color"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Color</FormLabel>
                    <FormControl>
                      <FormColorTagPicker
                        value={field.value || '#94a3b8'}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormDescription>Choose a color for this tag</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Parent tag field */}
              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parent Tag</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ''}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="No parent (root level)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="root">No parent (root level)</SelectItem>
                        {isLoadingTags ? (
                          <div className="flex items-center justify-center p-2">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading tags...
                          </div>
                        ) : (
                          renderTagOptions(
                            tags || [],
                            0,
                            [],
                            isEditing ? editingTag?.id : undefined
                          )
                        )}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Optional parent tag for hierarchical organization
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {/* Dialog footer with submit/cancel buttons */}
            <DialogFooter>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                type="submit"
                loading={isSubmitting}
                loadingText="Saving...">
                {isEditing ? 'Update Tag' : 'Create Tag'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
