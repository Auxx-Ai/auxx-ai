// apps/web/src/components/chat-widget/ui/settings/sections/behavior-section.tsx
'use client'
import { FieldType } from '@auxx/database/enums'
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
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
  BookOpen,
  Home,
  MessageSquare,
  MessageSquareOff,
  MousePointerClick,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { SettingsSection } from '~/components/global/settings-page'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'

interface BehaviorSectionProps {
  widget: ChatWidgetWithIntegration
  channelId: string
}

const behaviorSchema = z.object({
  autoOpen: z.boolean(),
  collectUserInfo: z.boolean(),
  offlineMessage: z.string().max(1000).optional(),
  // Home group
  homeShowRecentMessage: z.boolean(),
  homeShowSendMessageCta: z.boolean(),
  allowDownloadTranscript: z.boolean(),
  brandingFooterEnabled: z.boolean(),
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

  const cw = widget.chatWidget
  const form = useForm<BehaviorForm>({
    resolver: standardSchemaResolver(behaviorSchema),
    defaultValues: {
      autoOpen: cw?.autoOpen ?? false,
      collectUserInfo: cw?.collectUserInfo ?? false,
      offlineMessage: cw?.offlineMessage ?? '',
      homeShowRecentMessage: cw?.homeShowRecentMessage ?? true,
      homeShowSendMessageCta: cw?.homeShowSendMessageCta ?? true,
      allowDownloadTranscript: cw?.allowDownloadTranscript ?? true,
      brandingFooterEnabled: cw?.brandingFooterEnabled ?? true,
    },
  })

  const onSubmit = (values: BehaviorForm) => {
    update.mutate({
      integrationId: channelId,
      autoOpen: values.autoOpen,
      collectUserInfo: values.collectUserInfo,
      offlineMessage: values.offlineMessage || undefined,
      homeShowRecentMessage: values.homeShowRecentMessage,
      homeShowSendMessageCta: values.homeShowSendMessageCta,
      allowDownloadTranscript: values.allowDownloadTranscript,
      brandingFooterEnabled: values.brandingFooterEnabled,
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className='p-6 space-y-8'>
          <SettingsSection
            icon={SlidersHorizontal}
            title='Engagement'
            description='How and when the widget engages visitors.'>
            <VarEditorField
              orientation='responsive'
              className='p-0 **:data-[slot=field-row-label]:w-auto! @sm:**:data-[slot=field-row-label]:w-auto! **:data-[slot=field-row-content]:flex **:data-[slot=field-row-content]:justify-end **:data-[slot=field-row-content]:pe-3'>
              <FormField
                control={form.control}
                name='autoOpen'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Auto-open'
                    description='Automatically open the widget when a visitor lands on the page.'
                    type={BaseType.BOOLEAN}
                    icon={<MousePointerClick className='size-3.5' />}
                    showIcon
                    validationError={fieldState.error?.message}>
                    <div className='items-end'>
                      <FieldInputAdapter
                        fieldType={FieldType.CHECKBOX}
                        fieldOptions={{ variant: 'switch' }}
                        value={field.value}
                        onChange={(v) => field.onChange(Boolean(v))}
                      />
                    </div>
                  </VarEditorFieldRow>
                )}
              />

              <FormField
                control={form.control}
                name='collectUserInfo'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Collect Visitor Info'
                    description='Prompt visitors for name and email before the chat starts.'
                    type={BaseType.BOOLEAN}
                    icon={<UserPlus className='size-3.5' />}
                    showIcon
                    validationError={fieldState.error?.message}>
                    <FieldInputAdapter
                      fieldType={FieldType.CHECKBOX}
                      fieldOptions={{ variant: 'switch' }}
                      value={field.value}
                      onChange={(v) => field.onChange(Boolean(v))}
                    />
                  </VarEditorFieldRow>
                )}
              />

              <FormField
                control={form.control}
                name='homeShowRecentMessage'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Show recent message card'
                    description="Show a card linking to the visitor's most recent conversation."
                    type={BaseType.BOOLEAN}
                    icon={<MessageSquare className='size-3.5' />}
                    showIcon
                    validationError={fieldState.error?.message}>
                    <FieldInputAdapter
                      fieldType={FieldType.CHECKBOX}
                      fieldOptions={{ variant: 'switch' }}
                      value={field.value}
                      onChange={(v) => field.onChange(Boolean(v))}
                    />
                  </VarEditorFieldRow>
                )}
              />

              <FormField
                control={form.control}
                name='homeShowSendMessageCta'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Show "Send us a message" card'
                    description='Always-visible CTA that starts a new conversation.'
                    type={BaseType.BOOLEAN}
                    icon={<Sparkles className='size-3.5' />}
                    showIcon
                    validationError={fieldState.error?.message}>
                    <FieldInputAdapter
                      fieldType={FieldType.CHECKBOX}
                      fieldOptions={{ variant: 'switch' }}
                      value={field.value}
                      onChange={(v) => field.onChange(Boolean(v))}
                    />
                  </VarEditorFieldRow>
                )}
              />

              <FormField
                control={form.control}
                name='allowDownloadTranscript'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Allow transcript download'
                    description='Let visitors download a conversation as text.'
                    type={BaseType.BOOLEAN}
                    icon={<BookOpen className='size-3.5' />}
                    showIcon
                    validationError={fieldState.error?.message}>
                    <FieldInputAdapter
                      fieldType={FieldType.CHECKBOX}
                      fieldOptions={{ variant: 'switch' }}
                      value={field.value}
                      onChange={(v) => field.onChange(Boolean(v))}
                    />
                  </VarEditorFieldRow>
                )}
              />

              <FormField
                control={form.control}
                name='brandingFooterEnabled'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Show "Powered by" footer'
                    description='Display Auxx branding at the bottom of the widget.'
                    type={BaseType.BOOLEAN}
                    icon={<Home className='size-3.5' />}
                    showIcon
                    validationError={fieldState.error?.message}>
                    <FieldInputAdapter
                      fieldType={FieldType.CHECKBOX}
                      fieldOptions={{ variant: 'switch' }}
                      value={field.value}
                      onChange={(v) => field.onChange(Boolean(v))}
                    />
                  </VarEditorFieldRow>
                )}
              />
            </VarEditorField>
          </SettingsSection>

          <SettingsSection
            icon={MessageSquareOff}
            title='Offline'
            description='Message shown when chats start outside of operating hours.'>
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
          </SettingsSection>
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
