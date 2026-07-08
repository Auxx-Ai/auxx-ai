// apps/web/src/components/kb/ui/dialogs/kb-knowledge-base-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Form, FormField } from '@auxx/ui/components/form'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'

const knowledgeBaseSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
})

export type KnowledgeBaseFormValues = z.infer<typeof knowledgeBaseSchema>

interface KnowledgeBaseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: KnowledgeBaseFormValues) => void
  initialValues?: Partial<KnowledgeBaseFormValues>
  isSubmitting?: boolean
  mode: 'create' | 'edit'
}

export function KnowledgeBaseDialog({
  open,
  onOpenChange,
  onSubmit,
  initialValues = { name: '', slug: '' },
  isSubmitting = false,
  mode = 'create',
}: KnowledgeBaseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc'>
        <KnowledgeBaseDialogContent
          open={open}
          onSubmit={onSubmit}
          initialValues={initialValues}
          isSubmitting={isSubmitting}
          mode={mode}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

interface KnowledgeBaseDialogContentProps {
  open: boolean
  onSubmit: (values: KnowledgeBaseFormValues) => void
  initialValues: Partial<KnowledgeBaseFormValues>
  isSubmitting: boolean
  mode: 'create' | 'edit'
  onClose: () => void
}

function KnowledgeBaseDialogContent({
  open,
  onSubmit,
  initialValues,
  isSubmitting,
  mode,
  onClose,
}: KnowledgeBaseDialogContentProps) {
  const form = useForm<KnowledgeBaseFormValues>({
    resolver: standardSchemaResolver(knowledgeBaseSchema),
    defaultValues: initialValues,
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: only reset on open
  useEffect(() => {
    if (open) form.reset(initialValues)
  }, [open])

  const handleNameChange = (name: string) => {
    form.setValue('name', name, { shouldDirty: true })
    if (mode === 'create' && (!form.getValues('slug') || !form.getFieldState('slug').isDirty)) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
      form.setValue('slug', slug)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{mode === 'create' ? 'Create' : 'Edit'} Knowledge Base</DialogTitle>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldPanel
            orientation='responsive'
            breakpoint='sm'
            className='p-0'
            resizeId='kb-dialog'
            defaultLabelWidth={96}>
            <FormField
              control={form.control}
              name='name'
              render={({ field, fieldState }) => (
                <FieldPanelRow
                  title='Name'
                  type={BaseType.STRING}
                  showIcon
                  isRequired
                  validationError={fieldState.error?.message}>
                  <FieldInputAdapter
                    fieldType={FieldType.TEXT}
                    value={field.value}
                    onChange={(v) => handleNameChange((v as string) ?? '')}
                    placeholder='My Knowledge Base'
                    disabled={isSubmitting}
                  />
                </FieldPanelRow>
              )}
            />

            <FormField
              control={form.control}
              name='slug'
              render={({ field, fieldState }) => (
                <FieldPanelRow
                  title='Slug'
                  type={BaseType.STRING}
                  showIcon
                  isRequired
                  validationError={fieldState.error?.message}>
                  <FieldInputAdapter
                    fieldType={FieldType.TEXT}
                    value={field.value}
                    onChange={(v) => field.onChange((v as string) ?? '')}
                    placeholder='my-knowledge-base'
                    disabled={isSubmitting}
                  />
                </FieldPanelRow>
              )}
            />
          </FieldPanel>

          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={onClose}
              disabled={isSubmitting}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              type='submit'
              variant='outline'
              size='sm'
              loading={isSubmitting}
              loadingText={mode === 'create' ? 'Creating...' : 'Saving...'}>
              {mode === 'create' ? 'Create' : 'Save'} <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}
