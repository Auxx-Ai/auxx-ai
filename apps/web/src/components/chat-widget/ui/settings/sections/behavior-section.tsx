// apps/web/src/components/chat-widget/ui/settings/sections/behavior-section.tsx
'use client'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import { Button } from '@auxx/ui/components/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { MessageSquareOff, MousePointerClick, SlidersHorizontal, UserPlus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '~/trpc/react'

interface BehaviorSectionProps {
  widget: ChatWidgetWithIntegration
  channelId: string
}

const behaviorSchema = z.object({
  autoOpen: z.boolean(),
  collectUserInfo: z.boolean(),
  offlineMessage: z.string().max(1000).optional(),
})

type BehaviorForm = z.infer<typeof behaviorSchema>

export function BehaviorSection({ widget, channelId }: BehaviorSectionProps) {
  const utils = api.useUtils()

  const update = api.channel.updateChatWidgetIntegration.useMutation({
    onSuccess: () => {
      utils.channel.getChatWidgetIntegration.invalidate({ integrationId: channelId })
    },
    onError: (e) => toastError({ title: 'Failed to save', description: e.message }),
  })

  const form = useForm<BehaviorForm>({
    resolver: standardSchemaResolver(behaviorSchema),
    defaultValues: {
      autoOpen: widget.chatWidget?.autoOpen ?? false,
      collectUserInfo: widget.chatWidget?.collectUserInfo ?? false,
      offlineMessage: widget.chatWidget?.offlineMessage ?? '',
    },
  })

  const onSubmit = (values: BehaviorForm) => {
    update.mutate({
      integrationId: channelId,
      autoOpen: values.autoOpen,
      collectUserInfo: values.collectUserInfo,
      offlineMessage: values.offlineMessage || undefined,
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className='flex flex-col lg:flex-row'>
          <div className='flex-1 p-6 lg:pr-6'>
            <div className='space-y-1 mb-6'>
              <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                <SlidersHorizontal className='size-4' /> Engagement
              </div>
              <p className='text-sm text-muted-foreground'>
                How and when the widget engages visitors.
              </p>
            </div>

            <div className='space-y-4'>
              <FormField
                control={form.control}
                name='autoOpen'
                render={({ field }) => (
                  <div className='rounded-xl border px-3 py-2.5'>
                    <div
                      className='flex cursor-pointer items-center justify-between'
                      onClick={() => field.onChange(!field.value)}>
                      <div className='space-y-0.5'>
                        <Label className='flex cursor-pointer items-center gap-1.5 text-sm font-medium'>
                          <MousePointerClick className='size-3.5 text-muted-foreground' />
                          Auto-open
                        </Label>
                        <p className='text-xs text-muted-foreground'>
                          Automatically open the widget when a visitor lands on the page.
                        </p>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch size='sm' checked={field.value} onCheckedChange={field.onChange} />
                      </div>
                    </div>
                  </div>
                )}
              />

              <FormField
                control={form.control}
                name='collectUserInfo'
                render={({ field }) => (
                  <div className='rounded-xl border px-3 py-2.5'>
                    <div
                      className='flex cursor-pointer items-center justify-between'
                      onClick={() => field.onChange(!field.value)}>
                      <div className='space-y-0.5'>
                        <Label className='flex cursor-pointer items-center gap-1.5 text-sm font-medium'>
                          <UserPlus className='size-3.5 text-muted-foreground' />
                          Collect Visitor Info
                        </Label>
                        <p className='text-xs text-muted-foreground'>
                          Prompt visitors for name and email before the chat starts.
                        </p>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch size='sm' checked={field.value} onCheckedChange={field.onChange} />
                      </div>
                    </div>
                  </div>
                )}
              />
            </div>
          </div>

          <div className='flex-1 border-t lg:border-t-0 lg:border-l p-6 lg:pl-6'>
            <div className='space-y-1 mb-6'>
              <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                <MessageSquareOff className='size-4' /> Offline
              </div>
              <p className='text-sm text-muted-foreground'>
                Message shown when chats start outside of operating hours.
              </p>
            </div>

            <FormField
              control={form.control}
              name='offlineMessage'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Offline Message</FormLabel>
                  <FormControl>
                    <Textarea rows={6} placeholder="We're offline right now…" {...field} />
                  </FormControl>
                  <FormDescription>
                    Leave blank to fall back to the default message.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className='flex justify-end gap-2 border-t px-4 py-4'>
          <Button type='button' variant='ghost' size='sm' onClick={() => form.reset()}>
            Reset
          </Button>
          <Button
            type='submit'
            size='sm'
            variant='outline'
            loading={update.isPending}
            loadingText='Saving…'>
            Save Changes
          </Button>
        </div>
      </form>
    </Form>
  )
}
