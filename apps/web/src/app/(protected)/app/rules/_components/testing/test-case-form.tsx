// apps/web/src/app/(protected)/app/rules/_components/testing/test-case-form.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { z } from 'zod'
import { Plus, X } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { Badge } from '@auxx/ui/components/badge'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Separator } from '@auxx/ui/components/separator'

const testCaseSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  email: z.object({
    subject: z.string().min(1, 'Subject is required'),
    from: z.email('Valid email required'),
    to: z.array(z.email()).min(1, 'At least one recipient required'),
    cc: z.array(z.email()).optional(),
    body: z.string().min(1, 'Email body is required'),
  }),
  expectedRules: z.array(z.object({ ruleId: z.string(), ruleName: z.string() })).default([]),
  expectedActions: z.array(z.object({ type: z.string(), value: z.any() })).default([]),
  tags: z.array(z.string()).default([]),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT']).default('ACTIVE'),
})

type TestCaseFormData = z.infer<typeof testCaseSchema>

interface TestCaseFormProps {
  onSubmit: (data: TestCaseFormData) => Promise<void>
  isLoading?: boolean
  initialData?: Partial<TestCaseFormData>
  isEditMode?: boolean
  testCaseId?: string
}

export function TestCaseForm({
  onSubmit,
  isLoading,
  initialData,
  isEditMode = false,
  testCaseId,
}: TestCaseFormProps) {
  const router = useRouter()
  const [newTag, setNewTag] = useState('')
  const [newRecipient, setNewRecipient] = useState('')

  const form = useForm<TestCaseFormData>({
    resolver: standardSchemaResolver(testCaseSchema),
    defaultValues: initialData || {
      name: '',
      description: '',
      email: { subject: '', from: '', to: [], body: '' },
      expectedRules: [],
      expectedActions: [],
      tags: [],
      status: 'ACTIVE',
    },
  })

  const handleAddTag = () => {
    if (newTag.trim()) {
      const currentTags = form.getValues('tags')
      form.setValue('tags', [...currentTags, newTag.trim()])
      setNewTag('')
    }
  }

  const handleRemoveTag = (index: number) => {
    const currentTags = form.getValues('tags')
    form.setValue(
      'tags',
      currentTags.filter((_, i) => i !== index)
    )
  }

  const handleAddRecipient = () => {
    if (newRecipient.trim() && z.email().safeParse(newRecipient).success) {
      const currentTo = form.getValues('email.to')
      form.setValue('email.to', [...currentTo, newRecipient.trim()])
      setNewRecipient('')
    }
  }

  const handleRemoveRecipient = (index: number) => {
    const currentTo = form.getValues('email.to')
    form.setValue(
      'email.to',
      currentTo.filter((_, i) => i !== index)
    )
  }

  const handleFormSubmit = async (data: TestCaseFormData) => {
    console.log('Submitting form data:', data)
    try {
      await onSubmit(data)
    } catch (error) {
      console.error('Error submitting form:', error)
    }
  }
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
        {/* Basic Information */}
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Test Case Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g., Order confirmation test" {...field} />
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
                    placeholder="Describe what this test case validates..."
                    className="resize-none"
                    rows={3}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator />

        {/* Email Content */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Email Content</h3>

          <FormField
            control={form.control}
            name="email.subject"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Subject</FormLabel>
                <FormControl>
                  <Input placeholder="Email subject line" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email.from"
            render={({ field }) => (
              <FormItem>
                <FormLabel>From</FormLabel>
                <FormControl>
                  <Input placeholder="sender@example.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="space-y-2">
            <Label>To</Label>
            <div className="flex gap-2">
              <Input
                placeholder="recipient@example.com"
                value={newRecipient}
                onChange={(e) => setNewRecipient(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddRecipient()
                  }
                }}
              />
              <Button type="button" onClick={handleAddRecipient} size="sm">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {form.watch('email.to').map((email, index) => (
                <Badge key={index} variant="secondary">
                  {email}
                  <button
                    type="button"
                    onClick={() => handleRemoveRecipient(index)}
                    className="ml-2">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            {/* Error message for recipients */}
            {form.formState.errors.email?.to && (
              <p className="text-sm text-destructive mt-1">
                {form.formState.errors.email.to.message as string}
              </p>
            )}
          </div>

          <FormField
            control={form.control}
            name="email.body"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Body</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Email body content..."
                    className="resize-none min-h-[150px]"
                    {...field}
                  />
                </FormControl>
                <FormDescription>Enter the email body as HTML or plain text</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator />

        {/* Tags */}
        <div className="space-y-2">
          <Label>Tags</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Add a tag"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddTag()
                }
              }}
            />
            <Button type="button" onClick={handleAddTag} size="sm">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {form.watch('tags').map((tag, index) => (
              <Badge key={index} variant="secondary">
                {tag}
                <button type="button" onClick={() => handleRemoveTag(index)} className="ml-2">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="outline"
            disabled={isLoading}
            onClick={() => router.push('/app/rules/testing')}>
            Cancel
          </Button>
          <Button
            type="submit"
            loadingText={isEditMode ? 'Updating...' : 'Creating...'}
            loading={isLoading}>
            {isEditMode ? 'Update Test Case' : 'Create Test Case'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
