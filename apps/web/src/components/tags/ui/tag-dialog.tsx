// apps/web/src/components/tags/ui/tag-dialog.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import {
  DEFAULT_SELECT_OPTION_COLOR,
  SELECT_OPTION_COLORS,
  type SelectOptionColor,
} from '@auxx/types/custom-field'
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
import { ToggleCard } from '@auxx/ui/components/toggle-card'
import { cn } from '@auxx/ui/lib/utils'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Loader2, RotateCcw, Sparkles, Tag, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useCreateRecord } from '~/components/resources/hooks/use-create-record'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import {
  getTagTemplateDefault,
  isTemplateTag,
  TEMPLATE_TAG_UNDELETABLE_REASON,
} from '../category-defaults'
import { useTagHierarchy } from '../hooks/use-tag-hierarchy'
import type { TagNode } from '../types'
import { FormColorTagPicker } from './color-tag-picker'

/** Schema for tag form validation */
const tagFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  tag_description: z.string().optional().nullable(),
  tag_emoji: z.string().optional().nullable(),
  tag_color: z.string().optional().nullable(),
  tag_ai_classify: z.boolean(),
  parentId: z.string().optional().nullable(),
})

type TagFormValues = z.infer<typeof tagFormSchema>

/** Blank form state — shared by the create-mode reset paths so they cannot drift. */
const EMPTY_TAG_FORM: TagFormValues = {
  title: '',
  tag_description: '',
  tag_emoji: '',
  tag_color: 'gray',
  tag_ai_classify: false,
  parentId: undefined,
}

/**
 * Tag colors are stored as free-form strings on the field value; narrow to the palette so an
 * unrecognised value (e.g. a stale row written before a palette change) falls back to the
 * default rather than reaching the picker as an unknown swatch.
 */
function toTagColor(value: string | null | undefined): SelectOptionColor {
  return SELECT_OPTION_COLORS.find((color) => color === value) ?? DEFAULT_SELECT_OPTION_COLOR
}

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
  const { hierarchy, tagMap, fields, entityDefinitionId, refresh } = useTagHierarchy()

  const editingTag = isEditing && editingInstanceId ? tagMap.get(editingInstanceId) : undefined

  // System tags are read-only: server rejects edits via field-hooks guard, and
  // the dialog disables inputs + hides the save button as a UX safety net.
  const isSystemTag = editingTag?.isSystemTag === true
  const isReadOnly = isSystemTag

  // A SEEDED MAIL CATEGORY (plan 06 D4) — an ordinary tag carrying a
  // `tag_template_key`. ⚠️ Deliberately NOT folded into `isReadOnly`: that flag
  // belongs to `is_system_tag` and freezes `tag_description`, which is the one
  // field this whole feature exists to make editable (D4 vs D5). All the marker
  // changes here is that there is a shipped default to go back to, and that the
  // pre-delete hook will refuse a delete.
  //
  // ⚠️ Two separate questions, deliberately not one boolean:
  //   • `isTemplateCategory` — does the row carry the MARKER? That is what
  //     `rejectDeleteIfTemplateTag` reads, so it alone decides whether we may
  //     state "cannot be deleted".
  //   • `templateDefault` — does THIS BUILD know the shipped text for that key?
  //     A key seeded by a newer deploy resolves to undefined, and only the
  //     placeholder and "Reset to default" depend on it. Collapsing the two
  //     would make a category from a newer deploy silently look deletable.
  const isTemplateCategory = isTemplateTag(editingTag)
  const templateDefault = getTagTemplateDefault(editingTag?.templateKey)

  // `tag_ai_classify` reaches an org only once its entity migration has run. No
  // field row means no way to persist the flag, so the card is hidden rather
  // than shown as a control whose value silently goes nowhere.
  const aiClassifyFieldId = fields.tag_ai_classify?.id
  const canClassify = !!aiClassifyFieldId

  // Track if dialog has been initialized
  const isInitialized = useRef(false)

  // Track "create more" toggle
  const [createMore, setCreateMore] = useState(false)

  // Form setup
  const form = useForm<TagFormValues>({
    resolver: standardSchemaResolver(tagFormSchema),
    defaultValues: EMPTY_TAG_FORM,
  })

  // Eligibility drives the description's label, not just the card's body: when
  // it is on, `tag_description` stops being copy and becomes the classifier's
  // instruction for this label (plan C3).
  const aiClassify = form.watch('tag_ai_classify')
  const tagDescription = form.watch('tag_description')
  const tagTitle = form.watch('title')

  // Warn, but never block (plan Q5). A bare title like "Refunds" often carries
  // enough meaning, and silently excluding a tag whose switch is visibly on is
  // the worse failure — so the label set is built from eligibility alone and
  // this stays a hint.
  const missingClassifierInstruction = aiClassify && !tagDescription?.trim()

  // "Drifted" is anything that is not byte-identical to the shipped text —
  // including cleared, which is the case §4.1's placeholder covers. Compared
  // against the CURRENT form value rather than the saved one, so the affordance
  // disappears the moment a reset lands instead of waiting for a save.
  const descriptionHasDrifted =
    !!templateDefault && (tagDescription ?? '').trim() !== templateDefault.description

  /**
   * Put the shipped definition back in the field. Writes the form only — the
   * user still saves — so a mis-click is undone by cancelling the dialog.
   */
  const resetDescriptionToDefault = useCallback(() => {
    if (!templateDefault) return
    form.setValue('tag_description', templateDefault.description, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }, [form, templateDefault])

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
            tag_color: tag.tag_color || 'gray',
            tag_ai_classify: tag.aiClassify,
            parentId: tag.parentId || undefined,
          })
        }
      } else {
        // Create mode: reset to defaults
        form.reset(EMPTY_TAG_FORM)
      }
    } else {
      isInitialized.current = false
    }
  }, [open, recordId, editingInstanceId, tagMap, form])

  // Canonical create hook — seeds record + field-value caches and toasts on
  // error. The tag tree reads from `record.listAll`, so `refresh()` below still
  // pulls the new tag into the hierarchy view (seeding can't add listAll
  // membership); the seed keeps recordId-keyed tag consumers instant.
  const { create: createTag, isPending: isCreating } = useCreateRecord({
    entityDefinitionId: entityDefinitionId ?? '',
  })

  // Save field values hook for edit mode
  const { saveMultipleAsync, isPending: isSavingFields } = useSaveFieldValue()

  const isPending = isCreating || isSavingFields

  /** Reset form for creating another tag */
  const resetForm = useCallback(() => {
    form.reset(EMPTY_TAG_FORM)
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
            value: values.tag_color || 'gray',
            fieldType: 'TEXT',
          },
        ]

        // `tag_ai_classify` is a registry field materialized by an entity
        // migration, so an org that has not run it yet has no field row. Send
        // it only when it resolved to a real id — the key-string fallback above
        // would fail the whole multi-save and take the other four fields down
        // with it. The card is hidden in that state, so nothing is dropped.
        if (aiClassifyFieldId) {
          fieldValues.push({
            fieldId: aiClassifyFieldId,
            value: values.tag_ai_classify,
            fieldType: 'CHECKBOX',
          })
        }

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
          tag_color: values.tag_color || 'gray',
        }

        if (aiClassifyFieldId) {
          formValues.tag_ai_classify = values.tag_ai_classify
        }

        // Handle parent relationship for create (key is 'tag_parent')
        if (values.parentId) {
          formValues.tag_parent = [toRecordId(entityDefinitionId, values.parentId)]
        }

        const result = await createTag({ values: formValues })
        instanceId = result.instanceId
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

  /**
   * The `tag_description` field. Mounted inside the ToggleCard while
   * eligibility is on and beside it while off — exactly one of the two at a
   * time, so the value survives the move (react-hook-form owns it, not the
   * node) and there is never a duplicate textarea on screen.
   *
   * `aiMode` is the whole of plan C3: the field is unchanged, its meaning is
   * not, and this relabel is the only place a user can learn that.
   *
   * On a seeded category it also carries plan 06 §4's two affordances: the
   * shipped definition as the PLACEHOLDER (never the value — a cleared
   * description stays cleared, it just still shows what we would have said), and
   * "Reset to default" once the text has drifted.
   */
  const renderDescriptionField = (aiMode: boolean) => (
    <FormField
      control={form.control}
      name='tag_description'
      render={({ field }) => (
        <FormItem>
          {(aiMode || (descriptionHasDrifted && !isReadOnly)) && (
            <div
              className={cn(
                'flex min-h-7 items-center gap-2',
                aiMode ? 'justify-between' : 'justify-end'
              )}>
              {aiMode && <FormLabel>When should this tag apply?</FormLabel>}
              {descriptionHasDrifted && !isReadOnly && (
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='h-6 px-1.5 text-xs'
                  onClick={resetDescriptionToDefault}>
                  <RotateCcw />
                  Reset to default
                </Button>
              )}
            </div>
          )}
          <FormControl>
            <Textarea
              placeholder={
                templateDefault
                  ? templateDefault.description
                  : aiMode
                    ? 'e.g. Questions about invoices, charges, refunds or payment methods.'
                    : 'Optional description'
              }
              className='h-20 resize-none'
              {...field}
              value={field.value || ''}
              disabled={isReadOnly}
            />
          </FormControl>
          <FormDescription>
            {aiMode
              ? 'Auxx reads this to decide whether the tag fits an incoming message. Describe the mail it should match, not the tag.'
              : "Brief description of this tag's purpose"}
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>
            {isReadOnly ? 'System Tag' : isEditing ? 'Edit Tag' : 'Create New Tag'}
          </DialogTitle>
          <DialogDescription>
            {isReadOnly
              ? 'Managed by Auxx. Read-only.'
              : isEditing
                ? "Update this tag's details below."
                : 'Fill out the form below to create a new tag.'}
          </DialogDescription>
        </DialogHeader>

        {isReadOnly && (
          <div className='rounded-md bg-amber-100 border border-amber-300 px-3 py-2 text-sm text-amber-900'>
            This is a system tag. It cannot be modified or deleted.
          </div>
        )}

        {/* Seeded category. Muted, not amber: this is a statement of provenance,
            not a warning that something is frozen — everything below stays
            editable, and saying so is the point (plan 06 D4). The delete line is
            the UI half of `rejectDeleteIfTemplateTag`: no surface may offer a
            delete that the pre-delete hook will 403. */}
        {isTemplateCategory && !isReadOnly && (
          <div className='rounded-2xl border bg-muted/40 px-3 py-2 text-muted-foreground text-sm mb-2'>
            <span className='font-medium text-foreground'>Built-in mail category.</span> Rename it,
            recolour it and re-word its description to fit your business. The description is what
            the classifier reads. {TEMPLATE_TAG_UNDELETABLE_REASON}
            {canClassify &&
              aiClassify &&
              ' To stop it being used, switch off “Let AI apply this tag”.'}
          </div>
        )}

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
                            <Button
                              variant='outline'
                              size='icon'
                              className='mt-px rounded-full'
                              disabled={isReadOnly}>
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
                          <Input placeholder='Tag name' {...field} disabled={isReadOnly} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Description — plain when the tag is not AI-eligible, and the
                  classifier's instruction inside the card when it is. */}
              {(!canClassify || !aiClassify) && renderDescriptionField(false)}

              {/* AI classification opt-in */}
              {canClassify && (
                <FormField
                  control={form.control}
                  name='tag_ai_classify'
                  render={({ field }) => (
                    <ToggleCard
                      title='Let AI apply this tag'
                      description='Auxx reads incoming mail and applies this tag when it fits.'
                      icon={<Sparkles className='size-3.5' />}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isReadOnly}
                      collapsible
                      contentClassName='space-y-3'>
                      {field.value && renderDescriptionField(true)}
                      {missingClassifierInstruction && (
                        <p className='flex items-start gap-1.5 text-amber-700 text-xs dark:text-amber-500'>
                          <TriangleAlert className='mt-px size-3.5 shrink-0' />
                          <span className='min-w-0'>
                            Without a description the classifier only sees the name
                            {tagTitle?.trim() ? ` “${tagTitle.trim()}”` : ''}. The tag stays
                            eligible, but a sentence here makes it far more accurate.
                          </span>
                        </p>
                      )}
                    </ToggleCard>
                  )}
                />
              )}

              {/* Color picker */}
              <FormField
                control={form.control}
                name='tag_color'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Color</FormLabel>
                    <FormControl>
                      <FormColorTagPicker
                        value={toTagColor(field.value)}
                        onChange={field.onChange}
                        disabled={isReadOnly}
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
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || ''}
                      disabled={isReadOnly}>
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
                {isReadOnly ? (
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    onClick={() => onOpenChange(false)}>
                    Close <Kbd shortcut='esc' variant='outline' size='sm' />
                  </Button>
                ) : (
                  <>
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
                  </>
                )}
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
