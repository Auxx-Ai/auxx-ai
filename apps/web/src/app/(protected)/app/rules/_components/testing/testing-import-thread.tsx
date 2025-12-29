// apps/web/src/app/(protected)/app/rules/_components/testing/testing-import-thread.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { z } from 'zod'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { ThreadSelector } from './thread-selector'

const threadImportSchema = z.object({
  threadId: z.string().min(1, 'Please select a thread'),
  name: z.string().min(1, 'Test case name is required'),
  description: z.string().optional(),
  tags: z.string().optional(),
})

type ThreadImportFormData = z.infer<typeof threadImportSchema>

interface TestingImportThreadProps {
  onSubmit: (data: ThreadImportFormData) => Promise<void>
  isLoading?: boolean
}

export function TestingImportThread({ onSubmit, isLoading }: TestingImportThreadProps) {
  const router = useRouter()
  const form = useForm<ThreadImportFormData>({
    resolver: standardSchemaResolver(threadImportSchema),
    defaultValues: { threadId: '', name: '', description: '', tags: '' },
  })

  const handleThreadSelect = (threadId: string) => {
    form.setValue('threadId', threadId)
    // Auto-populate name if empty
    if (!form.getValues('name')) {
      form.setValue('name', `Test case for thread ${threadId.slice(-6)}`)
    }
  }

  const handleFormSubmit = async (data: ThreadImportFormData) => {
    try {
      await onSubmit(data)
    } catch (error) {
      console.error('Error submitting thread import form:', error)
    }
  }

  return (
    <div className="">
      <CardHeader>
        <CardTitle>Import from Email Thread</CardTitle>
        <CardDescription>Select an existing email thread to create a test case</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
            <div>
              <h4 className="font-medium mb-4">Select Thread</h4>
              <ThreadSelector onSelect={handleThreadSelect} filters={['has-rules-applied']} />
              {form.formState.errors.threadId && (
                <p className="text-sm text-destructive mt-2">
                  {form.formState.errors.threadId.message}
                </p>
              )}
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium mb-4">Test Case Details</h4>
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
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Describe what this test case validates"
                          rows={3}
                          className="resize-none"
                          {...field}
                        />
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
                      <FormLabel>Tags (optional)</FormLabel>
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
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? 'Creating...' : 'Create Test Case'}
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
