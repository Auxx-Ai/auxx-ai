// apps/web/src/components/chat-widget/ui/settings/sections/general-section.tsx
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
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Check, Code, Copy, InboxIcon, Power, Settings, Sparkles, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Tooltip } from '~/components/global/tooltip'
import { api } from '~/trpc/react'

interface GeneralSectionProps {
  widget: ChatWidgetWithIntegration
  channelId: string
  onDelete: () => void
}

const NO_INBOX_VALUE = '__NONE__'
const NO_AGENT_VALUE = '__NONE__'

const generalSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  title: z.string().min(1, 'Title is required').max(255),
  subtitle: z.string().max(255).optional(),
  welcomeMessage: z.string().max(1000).optional(),
  isActive: z.boolean(),
})

type GeneralForm = z.infer<typeof generalSchema>

export function GeneralSection({ widget, channelId, onDelete }: GeneralSectionProps) {
  const utils = api.useUtils()
  const { data: inboxes, isLoading: inboxesLoading } = api.inbox.getAll.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  })
  const { data: agents, isLoading: agentsLoading } = api.agent.list.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  })
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
      welcomeMessage: widget.chatWidget?.welcomeMessage ?? '',
      isActive: widget.chatWidget?.isActive ?? true,
    },
  })

  const onSubmit = (values: GeneralForm) => {
    update.mutate({
      integrationId: channelId,
      name: values.name,
      title: values.title,
      subtitle: values.subtitle || undefined,
      welcomeMessage: values.welcomeMessage || undefined,
      isActive: values.isActive,
    })
  }

  const handleInboxChange = (val: string) => {
    update.mutate({ integrationId: channelId, inboxId: val === NO_INBOX_VALUE ? null : val })
  }

  const handleAgentChange = (val: string) => {
    update.mutate({ integrationId: channelId, agentId: val === NO_AGENT_VALUE ? null : val })
  }

  const currentInboxId = widget.inboxIntegration?.inboxId ?? NO_INBOX_VALUE
  const currentAgentId = widget.chatWidget?.agentId ?? NO_AGENT_VALUE

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

            <div className='space-y-4'>
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Widget Name</FormLabel>
                    <FormControl>
                      <Input placeholder='Internal name' {...field} />
                    </FormControl>
                    <FormDescription>Shown only to your team.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='title'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Header Title</FormLabel>
                    <FormControl>
                      <Input placeholder='Chat' {...field} />
                    </FormControl>
                    <FormDescription>Appears at the top of the widget.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='subtitle'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subtitle (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder='We typically reply in minutes' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='welcomeMessage'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Welcome Message</FormLabel>
                    <FormControl>
                      <Input placeholder='Hi! How can we help?' {...field} />
                    </FormControl>
                    <FormDescription>Sent automatically when a chat starts.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='isActive'
                render={({ field }) => (
                  <div className='rounded-xl border px-3 py-2.5'>
                    <div
                      className='flex cursor-pointer items-center justify-between'
                      onClick={() => field.onChange(!field.value)}>
                      <div className='space-y-0.5'>
                        <Label className='flex cursor-pointer items-center gap-1.5 text-sm font-medium'>
                          <Power className='size-3.5 text-muted-foreground' />
                          Active
                        </Label>
                        <p className='text-xs text-muted-foreground'>
                          When off, the widget will not render or accept new chats.
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

          <div className='flex-1 border-t lg:border-t-0 lg:border-l p-6 lg:pl-6 space-y-8'>
            <div>
              <div className='space-y-1 mb-4'>
                <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                  <InboxIcon className='size-4' /> Routing
                </div>
                <p className='text-sm text-muted-foreground'>
                  Choose the inbox where new chat conversations land.
                </p>
              </div>
              <Select
                value={currentInboxId}
                onValueChange={handleInboxChange}
                disabled={inboxesLoading || update.isPending}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INBOX_VALUE}>— Not connected —</SelectItem>
                  {inboxes?.map((inbox) => (
                    <SelectItem key={inbox.id} value={inbox.id}>
                      {inbox.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className='space-y-1 mb-4'>
                <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                  <Sparkles className='size-4' /> AI Auto-Reply
                </div>
                <p className='text-sm text-muted-foreground'>
                  Pick an Agent that responds automatically to new chat messages. Leave unset to
                  require a human reply.
                </p>
              </div>
              {agentsLoading ? (
                <Skeleton className='h-10 w-full' />
              ) : (
                <Select
                  value={currentAgentId}
                  onValueChange={handleAgentChange}
                  disabled={update.isPending}>
                  <SelectTrigger>
                    <SelectValue placeholder='Choose an agent…' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_AGENT_VALUE}>— No auto-reply —</SelectItem>
                    {(agents ?? []).map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name || agent.slug || agent.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

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
