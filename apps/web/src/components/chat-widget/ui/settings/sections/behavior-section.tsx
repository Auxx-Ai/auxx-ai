// apps/web/src/components/chat-widget/ui/settings/sections/behavior-section.tsx
'use client'
import { FieldType } from '@auxx/database/enums'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import type { RecordId } from '@auxx/lib/resources/client'
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
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'
import { FeaturedArticlesField } from '../featured-articles-field'

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
  knowledgeBaseId: z.string().nullable(),
  featuredArticleIds: z.array(z.string()),
})

type BehaviorForm = z.infer<typeof behaviorSchema>

/**
 * Inline warning rendered under the KB picker when the selected KB is
 * INTERNAL. The widget reader only supports PUBLIC KBs in v1 — the server
 * also rejects the save, this just surfaces it before the click so the
 * admin doesn't waste the round-trip.
 */
function KbVisibilityWarning({ knowledgeBaseId }: { knowledgeBaseId: string | null }) {
  const enabled = !!knowledgeBaseId
  const { data } = api.kb.byId.useQuery(
    { id: knowledgeBaseId ?? '' },
    { enabled, staleTime: 60_000 }
  )
  if (!enabled || !data || data.visibility === 'PUBLIC') return null
  return (
    <p className='text-sm text-destructive'>
      This knowledge base is set to INTERNAL. Switch it to PUBLIC before saving — chat widgets only
      support PUBLIC knowledge bases.
    </p>
  )
}

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
      knowledgeBaseId: cw?.knowledgeBaseId ?? null,
      featuredArticleIds: cw?.featuredArticleIds ?? [],
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
      knowledgeBaseId: values.knowledgeBaseId,
      featuredArticleIds: values.featuredArticleIds,
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

        <div className='flex flex-col border-t lg:flex-row'>
          <div className='flex-1 p-6 lg:pr-6'>
            <div className='space-y-1 mb-6'>
              <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                <BookOpen className='size-4' /> Knowledge base
              </div>
              <p className='text-sm text-muted-foreground'>
                Source articles for the widget's Home and Browse screens.
              </p>
            </div>

            <VarEditorField orientation='responsive' className='p-0'>
              <FormField
                control={form.control}
                name='knowledgeBaseId'
                render={({ field, fieldState }) => {
                  const recordId = field.value ? (`kb:${field.value}` as RecordId) : null
                  return (
                    <VarEditorFieldRow
                      title='Knowledge base'
                      description="Articles from this KB power the widget's featured cards and Browse all view."
                      type={BaseType.RELATION}
                      icon={<BookOpen className='size-3.5' />}
                      showIcon
                      validationError={fieldState.error?.message}>
                      <MultiRelationInput
                        entityDefinitionId='kb'
                        value={recordId ? [recordId] : []}
                        multi={false}
                        placeholder='Link a knowledge base…'
                        onChange={(ids) => {
                          const first = ids[0]
                          if (!first) {
                            field.onChange(null)
                            return
                          }
                          const instanceId = first.includes(':')
                            ? first.split(':').slice(1).join(':')
                            : first
                          field.onChange(instanceId)
                        }}
                      />
                      <KbVisibilityWarning knowledgeBaseId={field.value} />
                    </VarEditorFieldRow>
                  )
                }}
              />
            </VarEditorField>
          </div>

          <div className='flex-1 border-t p-6 lg:border-t-0 lg:border-l lg:pl-6'>
            <div className='space-y-1 mb-6'>
              <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                <Home className='size-4' /> Featured articles
              </div>
              <p className='text-sm text-muted-foreground'>
                Pinned articles shown as cards on the Home screen.
              </p>
            </div>

            <FormField
              control={form.control}
              name='featuredArticleIds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Featured articles</FormLabel>
                  <FormControl>
                    <FeaturedArticlesField
                      knowledgeBaseId={form.watch('knowledgeBaseId')}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormDescription>
                    Pinned articles shown as cards on the Home screen. Drag to reorder.
                  </FormDescription>
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
