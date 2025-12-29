'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@auxx/ui/components/dialog'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'

// Schema for validation
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
  // Form for creating or editing knowledge base
  const form = useForm<KnowledgeBaseFormValues>({
    resolver: standardSchemaResolver(knowledgeBaseSchema),
    defaultValues: initialValues,
  })

  // Reset form when dialog opens/closes or when initialValues change
  useEffect(() => {
    if (open) {
      console.log('Opening dialog with initial values:', initialValues)
      form.reset(initialValues)
    }
  }, [open])

  // Handle slug generation from name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value
    form.setValue('name', name)

    // Only auto-generate slug if the user hasn't manually changed it
    // or if we're in create mode (not edit mode)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="mb-4">
          <DialogTitle>{mode === 'create' ? 'Create' : 'Edit'} Knowledge Base</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="My Knowledge Base" onChange={handleNameChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="my-knowledge-base" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="outline"
                loading={isSubmitting}
                loadingText={mode === 'create' ? 'Creating...' : 'Saving...'}>
                {mode === 'create' ? 'Create' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
