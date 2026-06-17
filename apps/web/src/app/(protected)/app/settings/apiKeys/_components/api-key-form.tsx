// apps/web/src/app/(protected)/app/settings/apiKeys/_components/api-key-form.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { DialogDescription, DialogFooter } from '@auxx/ui/components/dialog'
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
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { CopyInput } from '~/components/global/copy-input'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'

export const createApiKeyBody = z.object({
  id: z.string().nullish().optional(),
  name: z.string().optional(),
  hashedKey: z.string().nullish().optional(),
})
export type CreateApiKeyBody = z.infer<typeof createApiKeyBody>

/** Props for the shell-free API key create form core. */
export interface ApiKeyFormProps {
  /** Whether the form is "open" — drives the init/reset cycle. In a dialog this is
   *  the dialog's open state; in the palette it's `page === 'create-api-key'`. */
  open: boolean
  /** Called after a successful create. */
  onSuccess?: () => void
  /** Dismiss after the secret is revealed/done (dialog closes; palette closes). */
  onClose: () => void
  /** Cancel/back dismiss. Defaults to {@link onClose}; the palette routes it back
   *  to the root action list instead of closing outright. */
  onCancel?: () => void
  /** Host-specific header. Dialogs render a `DialogHeader`; the palette omits it
   *  (the breadcrumb supplies the title). */
  header?: (ctx: { title: string }) => ReactNode
}

/**
 * Shell-free API key create form: all hooks/state, the create mutation, the
 * post-create secret-reveal state, and the footer (Cancel / Create). The only host
 * seams are the `header` slot and `onClose`. `create-api-key-button.tsx` wraps this
 * in a `Dialog`; the command palette hosts it as a page. Create-only (no edit mode).
 */
export function ApiKeyForm({ open, onSuccess, onClose, onCancel, header }: ApiKeyFormProps) {
  const cancel = onCancel ?? onClose
  const utils = api.useUtils()
  const posthog = useAnalytics()
  const [secret, setSecret] = useState('')

  const form = useForm<CreateApiKeyBody>({
    resolver: standardSchemaResolver(createApiKeyBody),
    defaultValues: { name: '', hashedKey: '' },
  })

  // Reset form + clear the secret on a fresh open (open transitions to true).
  useEffect(() => {
    if (open) {
      form.reset()
      setSecret('')
    }
  }, [open, form])

  const createApiKey = api.apiKey.create.useMutation({
    onSuccess: async (data) => {
      setSecret(data.secretKey)
      toastSuccess({ description: 'API key created' })
      posthog?.capture('api_key_created')
      utils.apiKey.getAll.invalidate()
      onSuccess?.()
    },
    onError: (error) => {
      toastError({ description: error.message })
    },
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: createApiKey.mutateAsync is stable
  const onSubmit = useCallback(async (values: CreateApiKeyBody) => {
    await createApiKey.mutateAsync(values)
  }, [])

  const title = 'Create new secret key'

  return (
    <>
      {header?.({ title })}
      {secret ? (
        <>
          <DialogDescription className='mb-2'>
            This will only be shown once. Please copy it. Your secret key is:
          </DialogDescription>
          <CopyInput value={secret} toastMessage='Secret key copied to clipboard' />
          <div className='mt-4 flex items-center justify-end'>
            <Button type='button' size='sm' variant='outline' onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem className='flex flex-col gap-1'>
                  <FormLabel>Name (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder='My secret key' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                onClick={cancel}
                disabled={form.formState.isSubmitting}>
                Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              <Button
                type='submit'
                size='sm'
                variant='outline'
                loading={form.formState.isSubmitting}
                loadingText='Creating...'>
                Create <KbdSubmit variant='outline' size='sm' />
              </Button>
            </DialogFooter>
          </form>
        </Form>
      )}
    </>
  )
}
