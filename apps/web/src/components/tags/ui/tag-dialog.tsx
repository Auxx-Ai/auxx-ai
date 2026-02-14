// apps/web/src/components/tags/ui/tag-dialog.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { Button, buttonVariants } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { FormEmojiPicker } from '@auxx/ui/components/emoji-picker'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Loader2, Tag } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { api } from '~/trpc/react'
import { useTagHierarchy } from '../hooks/use-tag-hierarchy'
import type { TagNode } from '../types'
import { FormColorTagPicker } from './color-tag-picker'

/** Schema for tag form validation */
const tagFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  tag_description: z.string().optional().nullable(),
  tag_emoji: z.string().optional().nullable(),
  tag_color: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
})

type TagFormValues = z.infer<typeof tagFormSchema>

interface TagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** RecordId for edit mode (format: "entityDefinitionId:instanceId"), undefined for create */
  recordId?: RecordId
  /** Callback after successful save */
  onSaved?: (instanceId: string) => void
}

/**
 * Dialog for creating/editing tags.
 * Uses record.create for new tags and useSaveFieldValue for edits with optimistic updates.
 */
export function TagDialog({ open, onOpenChange, recordId, onSaved }: TagDialogProps) {
  // Parse recordId to get instance ID for editing
  const editingInstanceId = recordId ? parseRecordId(recordId).entityInstanceId : undefined
  const isEditing = !!editingInstanceId

  // Fetch tag hierarchy for parent selection (includes fields map for saving)
  const { hierarchy, flatTags, tagMap, fields, entityDefinitionId, refresh } = useTagHierarchy()

  // Track if dialog has been initialized
  const isInitialized = useRef(false)

  // Track "create more" toggle
  const [createMore, setCreateMore] = useState(false)

  // Form setup
  const form = useForm<TagFormValues>({
    resolver: standardSchemaResolver(tagFormSchema),
    defaultValues: {
      title: '',
      tag_description: '',
      tag_emoji: '',
      tag_color: '#94a3b8',
      parentId: undefined,
    },
  })

  // Initialize form when dialog opens
  useEffect(() => {
    if (open) {
      if (isInitialized.current) return
      isInitialized.current = true

      if (recordId && editingInstanceId) {
        // Edit mode: load values from tagMap
        const tag = tagMap.get(editingInstanceId)
        if (tag) {
          form.reset({
            title: tag.title,
            tag_description: tag.tag_description || '',
            tag_emoji: tag.tag_emoji || '',
            tag_color: tag.tag_color || '#94a3b8',
            parentId: tag.parentId || undefined,
          })
        }
      } else {
        // Create mode: reset to defaults
        form.reset({
          title: '',
          tag_description: '',
          tag_emoji: '',
          tag_color: '#94a3b8',
          parentId: undefined,
        })
      }
    } else {
      isInitialized.current = false
    }
  }, [open, recordId, editingInstanceId, tagMap, form])

  // Create mutation
  const createRecord = api.record.create.useMutation({
    onError: (error) => {
      toastError({ title: 'Failed to create tag', description: error.message })
    },
  })

  // Save field values hook for edit mode
  const { saveMultipleAsync, isPending: isSavingFields } = useSaveFieldValue()

  const isPending = createRecord.isPending || isSavingFields

  /** Reset form for creating another tag */
  const resetForm = useCallback(() => {
    form.reset({
      title: '',
      tag_description: '',
      tag_emoji: '',
      tag_color: '#94a3b8',
      parentId: undefined,
    })
  }, [form])

  /** Handle form submission */
  const handleSubmit = async (values: TagFormValues) => {
    // Normalize parentId
    if (values.parentId === 'root') {
      values.parentId = null
    }

    try {
      let instanceId: string

      if (isEditing && editingInstanceId && entityDefinitionId) {
        // Edit mode: update via saveMultipleAsync
        instanceId = editingInstanceId
        const tagRecordId = toRecordId(entityDefinitionId, instanceId)

        // Helper to get field ID from key (fallback to key if not found)
        const getFieldId = (key: string) => fields[key]?.id ?? key

        // Build field values array with resolved field IDs
        const fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }> = [
          { fieldId: getFieldId('title'), value: values.title, fieldType: 'TEXT' },
          {
            fieldId: getFieldId('tag_description'),
            value: values.tag_description || null,
            fieldType: 'RICH_TEXT',
          },
          { fieldId: getFieldId('tag_emoji'), value: values.tag_emoji || null, fieldType: 'TEXT' },
          {
            fieldId: getFieldId('tag_color'),
            value: values.tag_color || '#94a3b8',
            fieldType: 'TEXT',
          },
        ]

        // Handle parent relationship (key is 'tag_parent')
        if (values.parentId) {
          const parentRecordId = toRecordId(entityDefinitionId, values.parentId)
          fieldValues.push({
            fieldId: getFieldId('tag_parent'),
            value: [parentRecordId],
            fieldType: 'RELATIONSHIP',
          })
        } else {
          fieldValues.push({
            fieldId: getFieldId('tag_parent'),
            value: [],
            fieldType: 'RELATIONSHIP',
          })
        }

        const success = await saveMultipleAsync(tagRecordId, fieldValues)
        if (!success) return

        refresh()
      } else if (entityDefinitionId) {
        // Create mode: use record.create
        const formValues: Record<string, unknown> = {
          title: values.title,
          tag_description: values.tag_description || null,
          tag_emoji: values.tag_emoji || null,
          tag_color: values.tag_color || '#94a3b8',
        }

        // Handle parent relationship for create (key is 'tag_parent')
        if (values.parentId) {
          formValues.tag_parent = [toRecordId(entityDefinitionId, values.parentId)]
        }

        const result = await createRecord.mutateAsync({
          entityDefinitionId,
          values: formValues,
        })

        instanceId = result.instance.id
        refresh()
      } else {
        toastError({ title: 'Error', description: 'Tag entity not found' })
        return
      }

      onSaved?.(instanceId!)

      // If createMore is enabled and we're in create mode, reset form instead of closing
      if (createMore && !isEditing) {
        resetForm()
      } else {
        onOpenChange(false)
      }
    } catch {
      // Errors handled by mutation onError
    }
  }

  /** Render tag options recursively with indentation */
  const renderTagOptions = useCallback(
    (tagNodes: TagNode[], depth = 0, excludeId?: string): React.ReactNode => {
      if (!tagNodes) return null

      return tagNodes.map((tag) => {
        // Skip current tag when editing to prevent circular references
        if (excludeId && tag.id === excludeId) return null

        // Also skip descendants of current tag
        const isDescendantOfExcluded = excludeId && isDescendant(tag, excludeId, tagMap)
        if (isDescendantOfExcluded) return null

        const indentation = '—'.repeat(depth)
        const prefix = depth > 0 ? `${indentation} ` : ''

        return (
          <div key={tag.id}>
            <SelectItem value={tag.id}>
              {prefix}
              {tag.tag_emoji && `${tag.tag_emoji} `}
              {tag.title}
            </SelectItem>
            {tag.children?.length > 0 && renderTagOptions(tag.children, depth + 1, excludeId)}
          </div>
        )
      })
    },
    [tagMap]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Tag' : 'Create New Tag'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update this tag's details below."
              : 'Fill out the form below to create a new tag.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <div className='space-y-4'>
              {/* Title with emoji picker */}
              <div className='grid w-full grid-cols-[38px_auto] items-center justify-items-start gap-x-0'>
                <div>
                  <FormField
                    control={form.control}
                    name='tag_emoji'
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <FormEmojiPicker
                            value={field.value || ''}
                            onChange={field.onChange}
                            modal={false}>
                            <Button variant='outline' size='icon' className='mt-px rounded-full'>
                              {field.value || <Tag />}
                            </Button>
                          </FormEmojiPicker>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <div className='w-full'>
                  <FormField
                    control={form.control}
                    name='title'
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder='Tag name' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Description */}
              <FormField
                control={form.control}
                name='tag_description'
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        placeholder='Optional description'
                        className='h-20 resize-none'
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormDescription>Brief description of this tag's purpose</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Color picker */}
              <FormField
                control={form.control}
                name='tag_color'
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

              {/* Parent tag selection */}
              <FormField
                control={form.control}
                name='parentId'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parent Tag</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ''}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder='No parent (root level)' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value='root'>No parent (root level)</SelectItem>
                        {!hierarchy ? (
                          <div className='flex items-center justify-center p-2'>
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                            Loading tags...
                          </div>
                        ) : (
                          renderTagOptions(hierarchy, 0, isEditing ? editingInstanceId : undefined)
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

            <DialogFooter className='sm:justify-between'>
              {/* Left side: Create more toggle (only in create mode) */}
              <div>
                {!isEditing && (
                  <label
                    className={cn(
                      buttonVariants({ variant: 'ghost', size: 'sm' }),
                      'gap-2 cursor-pointer'
                    )}>
                    <span className='text-muted-foreground text-xs'>Create more</span>
                    <Switch
                      size='sm'
                      checked={createMore}
                      onCheckedChange={setCreateMore}
                      disabled={isPending}
                    />
                  </label>
                )}
              </div>

              {/* Right side: Action buttons */}
              <div className='flex items-center gap-2'>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  onClick={() => onOpenChange(false)}
                  disabled={isPending}>
                  Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  type='submit'
                  loading={isPending}
                  loadingText={isEditing ? 'Saving...' : 'Creating...'}
                  data-dialog-submit>
                  {isEditing ? 'Save Changes' : 'Create Tag'}{' '}
                  <KbdSubmit variant='outline' size='sm' />
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/** Check if a tag is a descendant of the excluded tag (to prevent circular references) */
function isDescendant(tag: TagNode, excludeId: string, tagMap: Map<string, TagNode>): boolean {
  let current = tag.parentId
  while (current) {
    if (current === excludeId) return true
    const parent = tagMap.get(current)
    current = parent?.parentId ?? null
  }
  return false
}
