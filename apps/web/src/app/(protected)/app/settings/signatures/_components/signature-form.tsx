// ~/components/signatures/signature-form.tsx
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
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { EditorProvider } from '~/components/editor/editor-context'
import TiptapEditor from '~/components/editor/tiptap-editor'
import { EditorToolbar } from '~/components/editor/editor-button'
import MultipleSelector from '@auxx/ui/components/multiselect'
import { SignatureSharingType } from '@auxx/database/enums'
// Define the form validation schema
const formSchema = z.object({
  name: z.string().min(1, 'Signature name is required'),
  body: z.string().min(1, 'Signature content is required'),
  isDefault: z.boolean().optional(),
  // Zod v4: nativeEnum deprecated; use enum with enum object
  sharingType: z.enum(SignatureSharingType),
  sharedIntegrationIds: z.array(z.string()).optional(),
})
type FormData = z.infer<typeof formSchema>
interface SignatureFormProps {
  signature?: {
    id: string
    name: string
    body: string
    isDefault: boolean
    sharingType: SignatureSharingType
    sharedIntegrations?: Array<{
      integrationId: string
      integration: {
        id: string
        email: string
      }
    }>
  }
  isAdmin?: boolean
  onSuccess?: () => void
}
export function SignatureForm({ signature, isAdmin = false, onSuccess }: SignatureFormProps) {
  const router = useRouter()
  const [html, setHtml] = useState(signature?.body || '')
  const utils = api.useUtils()
  // Fetch integrations for sharing options
  const { data: integrationsData = [] } = api.integration.getIntegrations.useQuery()
  const integrations = integrationsData?.google || []
  // Initialize form
  const form = useForm<FormData>({
    // Avoid early async validation flicker/errors on mount (Zod v4)
    resolver: standardSchemaResolver(formSchema, undefined, { mode: 'sync' }),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      name: signature?.name || '',
      body: signature?.body || '',
      isDefault: signature?.isDefault || false,
      sharingType: signature?.sharingType || SignatureSharingType.PRIVATE,
      sharedIntegrationIds: signature?.sharedIntegrations?.map((si) => si.integrationId) || [],
    },
  })
  // Watch the sharing type to conditionally show fields
  const sharingType = form.watch('sharingType')
  // tRPC mutations
  const createSignature = api.signature.create.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Signature created',
        description: 'Your signature has been created successfully.',
      })
      utils.signature.getAll.invalidate() // Invalidate cache for all signatures
      utils.signature.getDefaultForContext.invalidate() // Invalidate cache for default signatures
      if (onSuccess) {
        onSuccess()
      } else {
        router.push('/app/settings/signatures')
        router.refresh()
      }
    },
    onError: (error) => {
      toastError({ title: 'Error creating signature', description: error.message })
    },
  })
  const updateSignature = api.signature.update.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Signature updated',
        description: 'Your signature has been updated successfully.',
      })
      utils.signature.getAll.invalidate() // Invalidate cache for all signatures
      utils.signature.getDefaultForContext.invalidate() // Invalidate cache for default signatures
      if (onSuccess) {
        onSuccess()
      } else {
        router.push('/app/settings/signatures')
        router.refresh()
      }
    },
    onError: (error) => {
      toastError({ title: 'Error updating signature', description: error.message })
    },
  })
  // Form submission handler
  const onSubmit = (data: FormData) => {
    // Update the body field with current HTML from editor
    data.body = html
    if (signature) {
      // Update existing signature
      updateSignature.mutate({ id: signature.id, ...data })
    } else {
      // Create new signature
      createSignature.mutate(data)
    }
  }
  // Handle HTML changes from editor
  const handleEditorChange = (newHtml: string) => {
    setHtml(newHtml)
    // Mark dirty/touched without forcing validation before submit
    form.setValue('body', newHtml, { shouldDirty: true, shouldTouch: true })
  }
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
          name="sharingType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Sharing Settings</FormLabel>
              <Select
                disabled={!isAdmin && field.value === SignatureSharingType.ORGANIZATION_WIDE}
                onValueChange={field.onChange}
                defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select sharing type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={SignatureSharingType.PRIVATE}>Private (only you)</SelectItem>
                  {isAdmin && (
                    <SelectItem value={SignatureSharingType.ORGANIZATION_WIDE}>
                      Organization-wide (all users and integrations)
                    </SelectItem>
                  )}
                  <SelectItem value={SignatureSharingType.SPECIFIC_INTEGRATIONS}>
                    Specific integrations only
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Integration selection */}
        {sharingType === SignatureSharingType.SPECIFIC_INTEGRATIONS && (
          <FormField
            control={form.control}
            name="sharedIntegrationIds"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Share with Integrations</FormLabel>
                <FormControl>
                  <MultipleSelector
                    placeholder="Select integrations to share with"
                    options={integrations.map((integration) => ({
                      label: integration.email || integration.provider || 'Unknown integration',
                      value: integration.id,
                    }))}
                    defaultOptions={
                      field.value?.map((id) => {
                        const integration = integrations.find((i) => i.id === id)
                        return {
                          label:
                            integration?.email || integration?.provider || 'Unknown integration',
                          value: id,
                        }
                      }) || []
                    }
                    onChange={(selected) => field.onChange(selected.map((item) => item.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push('/app/settings/signatures')}>
            Cancel
          </Button>
          <Button
            variant="outline"
            type="submit"
            loading={createSignature.isPending || updateSignature.isPending}
            loadingText="Saving...">
            {signature ? 'Update Signature' : 'Create Signature'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
