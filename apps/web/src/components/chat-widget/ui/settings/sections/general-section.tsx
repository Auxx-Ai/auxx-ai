// apps/web/src/components/chat-widget/ui/settings/sections/general-section.tsx
'use client'
import { FieldType } from '@auxx/database/enums'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { getInstanceId, type RecordId, toRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Form, FormField } from '@auxx/ui/components/form'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
  Check,
  Code,
  Copy,
  ExternalLink,
  Eye,
  InboxIcon,
  Power,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  Type as TypeIcon,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { Tooltip } from '~/components/global/tooltip'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'

interface GeneralSectionProps {
  widget: ChatWidgetWithIntegration
  channelId: string
  onDelete: () => void
}

const generalSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  title: z.string().min(1, 'Title is required').max(255),
  subtitle: z.string().max(255).optional(),
  isActive: z.boolean(),
})

type GeneralForm = z.infer<typeof generalSchema>

export function GeneralSection({ widget, channelId, onDelete }: GeneralSectionProps) {
  const utils = api.useUtils()
  const { data: installCode, isLoading: installLoading } = api.channel.getInstallationCode.useQuery(
    { integrationId: channelId }
  )
  const { copied: copiedLink, copy: copyLink } = useCopy({
    toastMessage: 'Install snippet copied to clipboard',
  })

  const update = api.channel.updateChatWidgetIntegration.useMutation({
    onSuccess: () => {
      utils.channel.getChatWidgetIntegration.invalidate({ integrationId: channelId })
      utils.channel.list.invalidate()
    },
    onError: (e) => toastError({ title: 'Failed to save', description: e.message }),
  })

  const form = useForm<GeneralForm>({
    resolver: standardSchemaResolver(generalSchema),
    defaultValues: {
      name: widget.name || widget.chatWidget?.name || '',
      title: widget.chatWidget?.title ?? 'Chat',
      subtitle: widget.chatWidget?.subtitle ?? '',
      isActive: widget.chatWidget?.isActive ?? true,
    },
  })

  const onSubmit = (values: GeneralForm) => {
    update.mutate({
      integrationId: channelId,
      name: values.name,
      title: values.title,
      subtitle: values.subtitle || undefined,
      isActive: values.isActive,
    })
  }

  const rawInboxId = widget.inboxIntegration?.inboxId ?? null
  const inboxRecordId = rawInboxId ? toRecordId('inbox', rawInboxId) : null

  const handleInboxChange = (selected: RecordId[]) => {
    const nextRecordId = selected[0]
    if (!nextRecordId) {
      update.mutate({ integrationId: channelId, inboxId: null })
      return
    }
    // Picker emits RecordIds ("inbox:<id>") but the integration row stores the raw id.
    update.mutate({ integrationId: channelId, inboxId: getInstanceId(nextRecordId) })
  }

  const rawAgentId = widget.chatWidget?.agentId ?? null
  const agentActorIds: ActorId[] = rawAgentId ? [toActorId('agent', rawAgentId)] : []

  const handleAgentChange = (ids: ActorId[]) => {
    const next = ids[0]
    if (!next) {
      update.mutate({ integrationId: channelId, agentId: null })
      return
    }
    const { id } = parseActorId(next)
    update.mutate({ integrationId: channelId, agentId: id })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className='flex flex-col lg:flex-row'>
          <div className='flex-1 p-6 lg:pr-6'>
            <div className='space-y-1 mb-6'>
              <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                <Settings className='size-4' /> General
              </div>
              <p className='text-sm text-muted-foreground'>
                Internal name, header text, and active status.
              </p>
            </div>

            <VarEditorField orientation='responsive' className='p-0'>
              <FormField
                control={form.control}
                name='name'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Widget Name'
                    description='Shown only to your team.'
                    type={BaseType.STRING}
                    icon={<Tag className='size-3.5' />}
                    showIcon
                    isRequired
                    validationError={fieldState.error?.message}>
                    <FieldInputAdapter
                      fieldType={FieldType.TEXT}
                      value={field.value}
                      onChange={(v) => field.onChange((v as string) ?? '')}
                      placeholder='Internal name'
                    />
                  </VarEditorFieldRow>
                )}
              />

              <FormField
                control={form.control}
                name='title'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Header Title'
                    description='Appears at the top of the widget.'
                    type={BaseType.STRING}
                    icon={<TypeIcon className='size-3.5' />}
                    showIcon
                    isRequired
                    validationError={fieldState.error?.message}>
                    <FieldInputAdapter
                      fieldType={FieldType.TEXT}
                      value={field.value}
                      onChange={(v) => field.onChange((v as string) ?? '')}
                      placeholder='Chat'
                    />
                  </VarEditorFieldRow>
                )}
              />

              <FormField
                control={form.control}
                name='subtitle'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Subtitle'
                    description='Shown under the header title.'
                    type={BaseType.STRING}
                    icon={<TypeIcon className='size-3.5' />}
                    showIcon
                    validationError={fieldState.error?.message}>
                    <FieldInputAdapter
                      fieldType={FieldType.TEXT}
                      value={field.value ?? ''}
                      onChange={(v) => field.onChange((v as string) ?? '')}
                      placeholder='We typically reply in minutes'
                    />
                  </VarEditorFieldRow>
                )}
              />

              <FormField
                control={form.control}
                name='isActive'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Active'
                    description='When off, the widget will not render or accept new chats.'
                    type={BaseType.BOOLEAN}
                    icon={<Power className='size-3.5' />}
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

              <VarEditorFieldRow
                title='Inbox'
                description='Where new chat conversations land.'
                type={BaseType.RELATION}
                icon={<InboxIcon className='size-3.5' />}
                showIcon>
                <MultiRelationInput
                  entityDefinitionId='inbox'
                  value={inboxRecordId ? [inboxRecordId] : []}
                  onChange={handleInboxChange}
                  multi={false}
                  placeholder='Pick an inbox'
                  disabled={update.isPending}
                  triggerProps={{ className: 'w-full' }}
                />
              </VarEditorFieldRow>

              <VarEditorFieldRow
                title='AI Auto-Reply'
                description='Pick an Agent that responds automatically to new chat messages. Leave unset to require a human reply.'
                type={BaseType.ACTOR}
                icon={<Sparkles className='size-3.5' />}
                showIcon>
                <ActorPicker
                  value={agentActorIds}
                  onChange={handleAgentChange}
                  multi={false}
                  target='agent'
                  emptyLabel='Choose an agent…'
                  disabled={update.isPending}
                  triggerProps={{ className: 'w-full' }}
                />
              </VarEditorFieldRow>
            </VarEditorField>
          </div>

          <div className='flex-1 border-t lg:border-t-0 lg:border-l p-6 lg:pl-6 space-y-8'>
            <div>
              <div className='space-y-1 mb-4'>
                <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                  <Code className='size-4' /> Install
                </div>
                <p className='text-sm text-muted-foreground'>
                  Paste this snippet into your site's HTML, ideally just before{' '}
                  <code>&lt;/body&gt;</code>.
                </p>
              </div>
              {installLoading ? (
                <Skeleton className='h-9 w-full' />
              ) : installCode?.script ? (
                <InputGroup>
                  <InputGroupAddon align='inline-start'>
                    <Code />
                  </InputGroupAddon>
                  <InputGroupInput
                    type='text'
                    value={installCode.script}
                    readOnly
                    className='font-mono text-xs'
                    onFocus={(e) => e.target.select()}
                  />
                  <InputGroupAddon align='inline-end' className='gap-0.5'>
                    <Tooltip content='Copy'>
                      <InputGroupButton
                        aria-label='Copy install snippet'
                        className='rounded-full'
                        size='icon-xs'
                        onClick={() => copyLink(installCode.script)}>
                        {copiedLink ? <Check /> : <Copy />}
                      </InputGroupButton>
                    </Tooltip>
                  </InputGroupAddon>
                </InputGroup>
              ) : (
                <p className='text-sm text-destructive'>Could not load installation code.</p>
              )}
            </div>

            <div>
              <div className='space-y-1 mb-4'>
                <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                  <Eye className='size-4' /> Preview
                </div>
                <p className='text-sm text-muted-foreground'>
                  Open a live preview of this widget in a new tab to smoke-test your install snippet
                  and settings.
                </p>
              </div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => {
                  const width = 900
                  const height = 800
                  const left = Math.max(0, (window.screen.availWidth - width) / 2)
                  const top = Math.max(0, (window.screen.availHeight - height) / 2)
                  window.open(
                    `/preview/widget/${channelId}`,
                    `chat-widget-preview-${channelId}`,
                    `popup=yes,width=${width},height=${height},left=${left},top=${top}`
                  )
                }}>
                <ExternalLink className='size-4' />
                Open preview
              </Button>
            </div>
          </div>
        </div>

        <div className='flex flex-wrap items-center justify-between gap-3 border-t p-6'>
          <div className='space-y-1'>
            <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-destructive'>
              <Trash2 className='size-4' /> Danger zone
            </div>
            <p className='text-sm text-muted-foreground'>
              Permanently delete this widget and disconnect it from inboxes.
            </p>
          </div>
          <Button type='button' variant='destructive' size='sm' onClick={onDelete}>
            <Trash2 className='size-4' />
            Delete widget
          </Button>
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
