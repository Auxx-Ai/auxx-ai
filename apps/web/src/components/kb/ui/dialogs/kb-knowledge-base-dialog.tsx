// apps/web/src/components/kb/ui/dialogs/kb-knowledge-base-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

const knowledgeBaseSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
  isPublic: z.boolean().optional(),
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
  initialValues = { name: '', slug: '', isPublic: false },
  isSubmitting = false,
  mode = 'create',
}: KnowledgeBaseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
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

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value
    form.setValue('name', name)
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
      <DialogHeader className='mb-4'>
        <DialogTitle>{mode === 'create' ? 'Create' : 'Edit'} Knowledge Base</DialogTitle>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder='My Knowledge Base' onChange={handleNameChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='slug'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Slug</FormLabel>
                <FormControl>
                  <Input {...field} placeholder='my-knowledge-base' />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

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
