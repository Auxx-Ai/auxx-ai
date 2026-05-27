// apps/web/src/components/chat-widget/ui/settings/sections/general-section.tsx
'use client'
import { FieldType } from '@auxx/database/enums'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { getInstanceId, type RecordId, toRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Form, FormField } from '@auxx/ui/components/form'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
  InboxIcon,
  Link as LinkIcon,
  Power,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  Type as TypeIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { InboxDialog } from '~/components/inbox/inbox-dialog'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { useResource } from '~/components/resources/hooks/use-resource'
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

  const { resource: inboxResource } = useResource('inbox')
  const inboxEntityDefId = inboxResource?.entityDefinitionId ?? null
  const rawInboxId = widget.inboxIntegration?.inboxId ?? null
  const inboxRecordId =
    rawInboxId && inboxEntityDefId ? toRecordId(inboxEntityDefId, rawInboxId) : null

  const handleInboxChange = (selected: RecordId[]) => {
    const nextRecordId = selected[0]
    if (!nextRecordId) {
      update.mutate({ integrationId: channelId, inboxId: null })
      return
    }
    // Picker emits RecordIds ("inbox:<id>") but the integration row stores the raw id.
    update.mutate({ integrationId: channelId, inboxId: getInstanceId(nextRecordId) })
  }

  const [privacyUrlDraft, setPrivacyUrlDraft] = useState<string>(
    widget.chatWidget?.privacyPolicyUrl ?? ''
  )

  const [inboxDialogOpen, setInboxDialogOpen] = useState(false)

  const handleInboxCreated = (inbox: { id: string }) => {
    update.mutate({ integrationId: channelId, inboxId: inbox.id })
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
        <div className='p-6'>
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
                triggerProps={{ className: 'w-full ps-0 pe-1', badgeHoverCard: false }}
                onCreate={() => setInboxDialogOpen(true)}
                createLabel='Create inbox'
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
                triggerProps={{ className: 'w-full ps-0 pe-1' }}
              />
            </VarEditorFieldRow>

            <VarEditorFieldRow
              title='Privacy URL'
              description='When set, the widget shows a consent banner under the composer linking to this URL. Leave blank to hide.'
              type={BaseType.STRING}
              icon={<LinkIcon className='size-3.5' />}
              isRequired
              showIcon>
              <div
                onBlur={() => {
                  const next = privacyUrlDraft.trim()
                  const current = widget.chatWidget?.privacyPolicyUrl ?? ''
                  if (next === current) return
                  update.mutate({
                    integrationId: channelId,
                    privacyPolicyUrl: next === '' ? null : next,
                  })
                }}>
                <FieldInputAdapter
                  fieldType={FieldType.URL}
                  value={privacyUrlDraft}
                  onChange={(v) => setPrivacyUrlDraft((v as string) ?? '')}
                  placeholder='https://example.com/privacy'
                  disabled={update.isPending}
                />
              </div>
            </VarEditorFieldRow>
          </VarEditorField>
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
      {inboxDialogOpen && (
        <InboxDialog
          open={inboxDialogOpen}
          onOpenChange={setInboxDialogOpen}
          onSuccess={handleInboxCreated}
        />
      )}
    </Form>
  )
}
