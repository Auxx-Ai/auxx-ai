// apps/web/src/components/signatures/ui/signature-form.tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Form,
  FormControl,
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
import { Card, CardContent } from '@auxx/ui/components/card'
import { toastSuccess } from '@auxx/ui/components/toast'
import { EditorProvider } from '~/components/editor/editor-context'
import TiptapEditor from '~/components/editor/tiptap-editor'
import { EditorToolbar } from '~/components/editor/editor-button'
import { useSignatureMutations, type SignatureVisibility } from '../hooks'

/**
 * Form validation schema for signatures (new visibility model)
 */
const formSchema = z.object({
  name: z.string().min(1, 'Signature name is required'),
  body: z.string().min(1, 'Signature content is required'),
  isDefault: z.boolean().optional(),
  visibility: z.enum(['private', 'org_members', 'custom'] as const),
})

type FormData = z.infer<typeof formSchema>

interface SignatureFormProps {
  /** Signature to edit (if editing) */
  signature?: {
    id: string
    recordId?: string
    name: string
    body: string
    isDefault: boolean
    visibility: SignatureVisibility
  }
  isAdmin?: boolean
  onSuccess?: () => void
}

/**
 * Form component for creating and editing signatures.
 * Uses the entity system via useSignatureMutations hook.
 */
export function SignatureForm({ signature, isAdmin = false, onSuccess }: SignatureFormProps) {
  const router = useRouter()
  const [html, setHtml] = useState(signature?.body || '')
  const { create, update, isCreating, isUpdating } = useSignatureMutations()

  // Initialize form
  const form = useForm<FormData>({
    resolver: standardSchemaResolver(formSchema, undefined, { mode: 'sync' }),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      name: signature?.name || '',
      body: signature?.body || '',
      isDefault: signature?.isDefault || false,
      visibility: signature?.visibility || 'private',
    },
  })

  /**
   * Form submission handler
   */
  const onSubmit = async (data: FormData) => {
    data.body = html

    if (signature?.recordId) {
      // Update existing signature
      await update(signature.recordId, {
        name: data.name,
        body: data.body,
        isDefault: data.isDefault,
        visibility: data.visibility,
      })
      toastSuccess({
        title: 'Signature updated',
        description: 'Your signature has been updated successfully.',
      })
    } else {
      // Create new signature
      await create({
        name: data.name,
        body: data.body,
        isDefault: data.isDefault,
        visibility: data.visibility,
      })
      toastSuccess({
        title: 'Signature created',
        description: 'Your signature has been created successfully.',
      })
    }

    if (onSuccess) {
      onSuccess()
    } else {
      router.push('/app/settings/signatures')
      router.refresh()
    }
  }

  /**
   * Handle HTML changes from editor
   */
  const handleEditorChange = (newHtml: string) => {
    setHtml(newHtml)
    form.setValue('body', newHtml, { shouldDirty: true, shouldTouch: true })
  }

  const isPending = isCreating || isUpdating

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Signature Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Professional, Casual, Support Team" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-2">
          <EditorProvider>
            <FormLabel>Signature Content</FormLabel>
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="border-b px-3 py-2">
                  <EditorToolbar showSend={false} />
                </div>
                <div className="">
                  <TiptapEditor
                    content={html}
                    onChange={handleEditorChange}
                    placeholder="Design your signature here..."
                    className="h-full"
                  />
                </div>
              </CardContent>
            </Card>
            {form.formState.errors.body && (
              <p className="text-sm font-medium text-destructive">
                {form.formState.errors.body.message}
              </p>
            )}
          </EditorProvider>
        </div>

        <FormField
          control={form.control}
          name="isDefault"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={!!field.value}
                  onCheckedChange={(v) => field.onChange(Boolean(v))}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Set as default signature</FormLabel>
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="visibility"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Visibility</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select visibility" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="private">Private (only you)</SelectItem>
                  <SelectItem value="org_members">All Members</SelectItem>
                  {isAdmin && <SelectItem value="custom">Custom</SelectItem>}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push('/app/settings/signatures')}>
            Cancel
          </Button>
          <Button variant="outline" type="submit" loading={isPending} loadingText="Saving...">
            {signature ? 'Update Signature' : 'Create Signature'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
