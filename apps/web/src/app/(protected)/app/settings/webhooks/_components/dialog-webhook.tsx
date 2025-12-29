// apps/web/src/app/(protected)/app/settings/webhooks/_components/dialog-webhook.tsx
'use client'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Switch } from '@auxx/ui/components/switch'
import { Label } from '@auxx/ui/components/label'
import { useForm } from 'react-hook-form'
import { useWebhook } from './use-webhook'
import { EventTypePicker } from './event-type-picker'
import { z } from 'zod'

import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import type { WebhookEntity as Webhook } from '@auxx/database/models'
// Import event types from library
interface DialogWebhookProps {
  open: boolean
  onClose: () => void
  webhook?: Webhook
  onSuccess?: () => void
}
const webhookSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  url: z.string().url('Must be a valid URL'),
  eventTypes: z.array(z.string()).optional(),
  isActive: z.boolean().default(true),
})
type WebhookSchema = z.infer<typeof webhookSchema>
export function DialogWebhook({ open, onClose, webhook, onSuccess }: DialogWebhookProps) {
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
    if (onSuccess) onSuccess()
    onClose()
  }
  const handleTestWebhook = async () => {
    await testWebhook.mutateAsync({ url: currentUrl })
  }
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" position="tc">
        <DialogHeader>
          <DialogTitle>{webhook ? 'Edit Webhook' : 'Create Webhook'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="">
            <div className="space-y-4">
              <div className="space-y-2 mt-3">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input id="name" placeholder="My Webhook" {...field} />
                      </FormControl>

                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <Label htmlFor="url">URL</Label>
                    <FormControl>
                      <InputGroup>
                        <InputGroupInput
                          id="url"
                          placeholder="https://example.com/webhook"
                          {...field}
                        />
                        <InputGroupAddon align="inline-end" className="">
                          <Button
                            type="button"
                            variant="outline"
                            className="mr-0.5"
                            size="xs"
                            onClick={handleTestWebhook}
                            disabled={testWebhook.isPending || !currentUrl}
                            loading={testWebhook.isPending}
                            loadingText="Testing...">
                            Test
                          </Button>
                        </InputGroupAddon>
                      </InputGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                {/* Replace the old eventTypes selector with the new EventTypePicker */}
                <EventTypePicker
                  selectedEventTypes={selectedEventTypes}
                  onChange={setSelectedEventTypes}
                  placeholder="Select event types..."
                />
              </div>

              <div className="flex items-center space-x-2">
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg shadow-none  gap-2 space-y-0">
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className="">
                        <FormLabel className="mt-0 pt-0">Active</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                type="button"
                disabled={create.isPending || update.isPending}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                loading={create.isPending || update.isPending}
                loadingText="Saving...">
                {webhook ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
