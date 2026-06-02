// apps/web/src/components/chat-widget/ui/settings/sections/ai-section.tsx
'use client'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import type { RecordId } from '@auxx/lib/resources/client'
import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@auxx/ui/components/form'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { BookOpen, Bot, Home, Sparkles } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'
import { FeaturedArticlesField } from '../featured-articles-field'

interface AiSectionProps {
  widget: ChatWidgetWithIntegration
  channelId: string
}

const aiSchema = z.object({
  knowledgeBaseId: z.string().nullable(),
  featuredArticleIds: z.array(z.string()),
})

type AiForm = z.infer<typeof aiSchema>

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

export function AiSection({ widget, channelId }: AiSectionProps) {
  const utils = api.useUtils()

  const update = api.channel.updateChatWidgetIntegration.useMutation({
    onSuccess: () => {
      utils.channel.getChatWidgetIntegration.invalidate({ integrationId: channelId })
      utils.channel.list.invalidate()
    },
    onError: (e) => toastError({ title: 'Failed to save', description: e.message }),
  })

  // Only chat-kind agents can answer visitor chat — surface them only in the
  // picker. The server-side bind validation is the hard guard; this is the
  // matching UX. See plans/chat/v5 phase-2 §9.
  const { data: agents } = api.agent.list.useQuery()
  const chatAgentActorIds = useMemo(
    () =>
      new Set<ActorId>(
        (agents ?? []).filter((a) => a.kind === 'chat').map((a) => toActorId('agent', a.id))
      ),
    [agents]
  )
  const agentFilter = useCallback(
    (actorId: ActorId) => chatAgentActorIds.has(actorId),
    [chatAgentActorIds]
  )

  const cw = widget.chatWidget
  const rawAgentId = cw?.agentId ?? null
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

  const form = useForm<AiForm>({
    resolver: standardSchemaResolver(aiSchema),
    defaultValues: {
      knowledgeBaseId: cw?.knowledgeBaseId ?? null,
      featuredArticleIds: cw?.featuredArticleIds ?? [],
    },
  })

  const onSubmit = (values: AiForm) => {
    update.mutate({
      integrationId: channelId,
      knowledgeBaseId: values.knowledgeBaseId,
      featuredArticleIds: values.featuredArticleIds,
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className='p-6'>
          <div className='space-y-1 mb-4'>
            <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
              <Bot className='size-4' /> Agent
            </div>
            <p className='text-sm text-muted-foreground'>
              The AI agent that replies to incoming chat messages.
            </p>
          </div>

          <VarEditorField orientation='responsive' className='p-0'>
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
                agentFilter={agentFilter}
                emptyLabel='Choose an agent…'
                disabled={update.isPending}
                triggerProps={{ className: 'w-full ps-0 pe-1' }}
              />
            </VarEditorFieldRow>
          </VarEditorField>
        </div>

        <div className='border-t p-6 space-y-4'>
          <div>
            <div className='space-y-1 mb-4'>
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

          <div>
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
