// apps/web/src/components/webhooks/ui/webhook-form.tsx
'use client'

import type { WebhookEntity as Webhook } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { type ReactNode, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useWebhook } from '../hooks/use-webhook'
import { EventTypePicker } from './event-type-picker'

const webhookSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  url: z.string().url('Must be a valid URL'),
  eventTypes: z.array(z.string()).optional(),
  isActive: z.boolean().default(true),
})
type WebhookSchema = z.infer<typeof webhookSchema>

/** Props for the shell-free webhook create/edit form core. */
export interface WebhookFormProps {
  /** Whether the form is "open" — drives the init/reset cycle. In a dialog this is
   *  the dialog's open state; in the palette it's `page === 'create-webhook'`. */
  open: boolean
  /** Webhook to edit; omitted = create */
  webhook?: Webhook
  /** Called after a successful save */
  onSuccess?: () => void
  /** Dismiss after a successful save (dialog closes; palette closes). */
  onClose: () => void
  /** Cancel/back dismiss. Defaults to {@link onClose}; the palette routes it back
   *  to the root action list instead of closing outright. */
  onCancel?: () => void
  /** Host-specific header. Dialogs render a `DialogHeader`; the palette omits it
   *  (the breadcrumb supplies the title). */
  header?: (ctx: { title: string }) => ReactNode
}

/**
 * Shell-free webhook create/edit form: all hooks/state, the field body, and the
 * footer (Cancel / Create|Update). The only host seams are the `header` slot and
 * `onClose`. `dialog-webhook.tsx` wraps this in a `Dialog`; the command palette
 * hosts it as a page.
 */
export function WebhookForm({
  open,
  webhook,
  onSuccess,
  onClose,
  onCancel,
  header,
}: WebhookFormProps) {
  const cancel = onCancel ?? onClose
  const { create, update, testWebhook } = useWebhook()
  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>(webhook?.eventTypes || [])

  const form = useForm<WebhookSchema>({
    resolver: standardSchemaResolver(webhookSchema),
    defaultValues: {
      name: webhook?.name || '',
      url: webhook?.url || '',
      isActive: webhook?.isActive ?? true,
    },
  })

  // Reset/re-init the form whenever the form becomes "open".
  useEffect(() => {
    if (open) {
      form.reset({
        name: webhook?.name || '',
        url: webhook?.url || '',
        isActive: webhook?.isActive ?? true,
      })
      setSelectedEventTypes(webhook?.eventTypes || [])
    }
  }, [open, webhook, form])

  const currentUrl = form.watch('url')

  const onSubmit = async (data: { name: string; url: string; isActive: boolean }) => {
    if (webhook) {
      await update.mutateAsync({
        id: webhook.id,
        name: data.name,
        url: data.url,
        eventTypes: selectedEventTypes,
        isActive: data.isActive,
      })
    } else {
      await create.mutateAsync({
        name: data.name,
        url: data.url,
        eventTypes: selectedEventTypes,
        isActive: data.isActive,
      })
    }
    onSuccess?.()
    onClose()
  }

  const handleTestWebhook = async () => {
    await testWebhook.mutateAsync({ url: currentUrl })
  }

  const title = webhook ? 'Edit Webhook' : 'Create Webhook'
  const isPending = create.isPending || update.isPending

  return (
    <>
      {header?.({ title })}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className=''>
          <div className='space-y-4'>
            <div className='space-y-2 mt-3'>
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input id='name' placeholder='My Webhook' {...field} />
                    </FormControl>

                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name='url'
              render={({ field }) => (
                <FormItem>
                  <Label htmlFor='url'>URL</Label>
                  <FormControl>
                    <InputGroup>
                      <InputGroupInput
                        id='url'
                        placeholder='https://example.com/webhook'
                        {...field}
                      />
                      <InputGroupAddon align='inline-end' className=''>
                        <Button
                          type='button'
                          variant='outline'
                          className='mr-0.5'
                          size='xs'
                          onClick={handleTestWebhook}
                          disabled={testWebhook.isPending || !currentUrl}
                          loading={testWebhook.isPending}
                          loadingText='Testing...'>
                          Test
                        </Button>
                      </InputGroupAddon>
                    </InputGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='space-y-2'>
              <EventTypePicker
                selectedEventTypes={selectedEventTypes}
                onChange={setSelectedEventTypes}
                placeholder='Select event types...'
              />
            </div>

            <div className='flex items-center space-x-2'>
              <FormField
                control={form.control}
                name='isActive'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between rounded-lg shadow-none  gap-2 space-y-0'>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <div className=''>
                      <FormLabel className='mt-0 pt-0'>Active</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant='ghost' size='sm' onClick={cancel} type='button' disabled={isPending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              type='submit'
              size='sm'
              variant='outline'
              loading={isPending}
              loadingText='Saving...'>
              {webhook ? 'Update' : 'Create'} <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}
