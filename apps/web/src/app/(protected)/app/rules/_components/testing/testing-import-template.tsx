// apps/web/src/app/(protected)/app/rules/_components/testing/testing-import-template.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { z } from 'zod'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { TemplateSelector } from './template-selector'

const templateImportSchema = z.object({
  templateId: z.string().min(1, 'Please select a template'),
  name: z.string().min(1, 'Test case name is required'),
  tags: z.string().optional(),
})

type TemplateImportFormData = z.infer<typeof templateImportSchema>

interface Template {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
}

interface TestingImportTemplateProps {
  onSubmit: (data: TemplateImportFormData & { template: Template }) => Promise<void>
  isLoading?: boolean
}

export function TestingImportTemplate({ onSubmit, isLoading }: TestingImportTemplateProps) {
  const router = useRouter()
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)

  const form = useForm<TemplateImportFormData>({
    resolver: standardSchemaResolver(templateImportSchema),
    defaultValues: { templateId: '', name: '', tags: '' },
  })

  const handleTemplateSelect = (template: Template) => {
    setSelectedTemplate(template)
    form.setValue('templateId', template.id)

    // Auto-populate name and tags if empty
    if (!form.getValues('name')) {
      form.setValue('name', `${template.name} - Test Case`)
    }
    if (!form.getValues('tags')) {
      form.setValue('tags', template.tags.join(', '))
    }
  }

  const handleFormSubmit = async (data: TemplateImportFormData) => {
    if (!selectedTemplate) {
      form.setError('templateId', { error: 'Please select a template' })
      return
    }

    try {
      await onSubmit({ ...data, template: selectedTemplate })
    } catch (error) {
      console.error('Error submitting template import form:', error)
    }
  }

  return (
    <div>
      <CardHeader>
        <CardTitle>Use Template</CardTitle>
        <CardDescription>Start with a pre-built test case template</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
            <div>
              <h4 className="font-medium mb-4">Select Template</h4>
              <TemplateSelector onSelect={handleTemplateSelect} />
              {form.formState.errors.templateId && (
                <p className="text-sm text-destructive mt-2">
                  {form.formState.errors.templateId.message}
                </p>
              )}

              {selectedTemplate && (
                <div className="mt-4 p-3 bg-muted rounded-md">
                  <p className="text-sm">
                    <strong>Selected:</strong> {selectedTemplate.name}
                  </p>
                  <p className="text-sm text-muted-foreground">{selectedTemplate.description}</p>
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium mb-4">Customize Template</h4>
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Test Case Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter a name for this test case" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tags"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tags</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter tags separated by commas" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push('/app/rules/testing')}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isLoading || !selectedTemplate}>
                    {isLoading ? 'Creating...' : 'Create from Template'}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </Form>
      </CardContent>
    </div>
  )
}
