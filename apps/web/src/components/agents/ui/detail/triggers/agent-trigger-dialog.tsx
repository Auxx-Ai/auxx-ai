// apps/web/src/components/agents/ui/detail/triggers/agent-trigger-dialog.tsx
'use client'

import { isNonEmptyDoc, type TiptapDoc } from '@auxx/lib/tiptap'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Field, FieldLabel } from '@auxx/ui/components/field'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Field as ResourceField } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import type { JSONContent } from '@tiptap/core'
import { ChevronDown, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { AppAccountPicker } from '~/components/apps/ui/app-account-picker'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { DEFAULT_TABS } from '~/components/editor/inline-picker'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import { PromptEditor } from '~/components/editor/prompt-editor'
import {
  DEFAULT_SCHEDULED_STATE,
  type ScheduledState,
  ScheduleEditor,
  scheduledConfigFromState,
  scheduledStateFromConfig,
} from '~/components/global/schedule'
import {
  isMissing,
  readFieldNodes,
  SchemaField,
  seedDefaults,
} from '~/components/global/schema-form'
import { ResourcePicker } from '~/components/pickers/resource-picker'
import { TriggerSourceRow } from '~/components/pickers/trigger-source'
import { useResources } from '~/components/resources/hooks/use-resources'
import { WebhookEndpointInspector } from '~/components/webhooks/ui/webhook-endpoint-inspector'
import { WebhookTopicPicker } from '~/components/webhooks/ui/webhook-topic-picker'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'

const TEMPLATE_REFERENCE_TABS: ReferenceTab[] = [...DEFAULT_TABS, 'tools', 'resources', 'fields']

const KIND_COPY: Record<Kind, { label: string; description: string }> = {
  scheduled: {
    label: 'scheduled',
    description: 'Fire this agent on a recurring schedule.',
  },
  event: {
    label: 'event',
    description: 'Fire this agent when a resource is created, updated, or deleted.',
  },
  app: {
    label: 'app',
    description: 'Fire this agent when an installed app emits a trigger event.',
  },
  'webhook-endpoint': {
    label: 'webhook',
    description: 'Fire this agent when a webhook endpoint receives a delivery.',
  },
  mention: {
    label: 'mention',
    description: 'Fire this agent when it is mentioned in a comment.',
  },
  assignment: {
    label: 'assignment',
    description: 'Fire this agent when it is assigned to a ticket.',
  },
  dm: {
    label: 'DM',
    description: 'Fire this agent when a user direct-messages it.',
  },
}

function emptyPromptDoc(): TiptapDoc {
  return { type: 'doc', content: [{ type: 'block', attrs: { blockType: 'text' }, content: [] }] }
}

function readPromptContent(doc: TiptapDoc | null | undefined): JSONContent[] | null {
  return (doc?.content as JSONContent[] | undefined) ?? null
}

type Trigger = RouterOutputs['agentTrigger']['list'][number]

type Kind = 'scheduled' | 'event' | 'app' | 'webhook-endpoint' | 'mention' | 'assignment' | 'dm'
type CrudTriggerType = 'created' | 'updated' | 'deleted'

const RESOURCE_OPERATIONS: Record<CrudTriggerType, { operation: CrudTriggerType; label: string }> =
  {
    created: { operation: 'created', label: 'Created' },
    updated: { operation: 'updated', label: 'Updated' },
    deleted: { operation: 'deleted', label: 'Deleted' },
  }

interface AgentTriggerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  /** Kind to create; ignored in edit mode (derived from `trigger.kind`). */
  kind: Kind
  /** When provided, dialog is in edit mode for this trigger. */
  trigger?: Trigger
  /**
   * Pre-selected app + trigger metadata when opening for a new `app` kind.
   * Required to render the header chip and inputs form before the row exists.
   */
  appSelection?: {
    installationId: string
    appId: string
    appTitle: string
    appAvatarUrl: string | null
    triggerId: string
    triggerLabel: string
    triggerDescription?: string
    inputsJsonSchema: Record<string, unknown>
  }
  /**
   * Pre-selected webhook endpoint when opening for a new `webhook-endpoint` kind.
   * Required to render the header chip before the row exists.
   */
  webhookSelection?: {
    webhookEndpointId: string
    endpointName: string
    endpointUrl: string
    /** Whether the endpoint extracts a topic — drives whether the topic input is meaningful. */
    hasTopicSource: boolean
  }
  onSuccess?: () => void
  /** Re-pick the source (app trigger / webhook endpoint) — closes the dialog and re-opens the picker. */
  onRepick?: () => void
}

interface EventState {
  triggerType: CrudTriggerType
  entityDefinitionId: string
}

const DEFAULT_EVENT_STATE: EventState = {
  triggerType: 'created',
  entityDefinitionId: 'ticket',
}

interface AppState {
  /** `null` means "any connection". */
  connectionId: string | null
  userInputs: Record<string, unknown>
}

const DEFAULT_APP_STATE: AppState = {
  connectionId: null,
  userInputs: {},
}

function eventStateFromTrigger(trigger: Trigger, fallbackEntityId: string): EventState {
  return {
    triggerType: (trigger.triggerType as CrudTriggerType) ?? 'created',
    entityDefinitionId: trigger.entityDefinitionId ?? fallbackEntityId,
  }
}

function appStateFromTrigger(trigger: Trigger): AppState {
  const config = (trigger.config as Record<string, unknown> | null) ?? {}
  const userInputsRaw = (config.userInputs as Record<string, unknown> | undefined) ?? {}
  return {
    connectionId: trigger.triggerConnectionId ?? null,
    userInputs: { ...userInputsRaw },
  }
}

/**
 * Dialog for creating or editing an agent trigger. The `kind` is selected
 * upstream (from the section-header dropdown) and is immutable in this
 * dialog.
 */
export function AgentTriggerDialog({
  open,
  onOpenChange,
  agentId,
  kind,
  trigger,
  appSelection,
  webhookSelection,
  onSuccess,
  onRepick,
}: AgentTriggerDialogProps) {
  const isEditMode = !!trigger
  const effectiveKind: Kind = isEditMode && trigger ? (trigger.kind as Kind) : kind
  const kindCopy = KIND_COPY[effectiveKind]
  const isBuiltinKind =
    effectiveKind === 'mention' || effectiveKind === 'assignment' || effectiveKind === 'dm'
  const isAppKind = effectiveKind === 'app'
  const isWebhookKind = effectiveKind === 'webhook-endpoint'

  const { appInstallations, appConnections } = useAppsContext()

  // For app-kind edit: resolve the installation + trigger projection from the
  // cache envelope so we can render header chip + inputs form.
  const appContext = useMemo(() => {
    if (!isAppKind) return null
    if (appSelection) {
      return appSelection
    }
    if (!trigger) return null
    const installation =
      appInstallations.find((i) => i.installationId === trigger.triggerInstallationId) ??
      appInstallations.find((i) => i.app.id === trigger.triggerAppId)
    const triggerProj = installation?.agentTriggers?.find(
      (t) => t.triggerId === trigger.triggerAppTriggerId
    )
    return {
      installationId: installation?.installationId ?? trigger.triggerInstallationId ?? '',
      appId: trigger.triggerAppId ?? installation?.app.id ?? '',
      appTitle: installation?.app.title ?? trigger.triggerAppId ?? 'App',
      appAvatarUrl: installation?.app.avatarUrl ?? null,
      triggerId: trigger.triggerAppTriggerId ?? '',
      triggerLabel: triggerProj?.label ?? trigger.triggerAppTriggerId ?? '',
      triggerDescription: triggerProj?.description,
      inputsJsonSchema: (triggerProj?.inputsJsonSchema as Record<string, unknown>) ?? {},
    }
  }, [isAppKind, appSelection, trigger, appInstallations])

  // For webhook-endpoint kind: resolve the endpoint name + URL. New rows carry it on
  // `webhookSelection`; edit rows resolve `triggerWebhookEndpointId` against the org
  // endpoint list so we render the name rather than the raw id.
  const webhookEndpointsQuery = api.webhookEndpoint.list.useQuery(undefined, {
    enabled: open && isWebhookKind,
  })
  const webhookContext = useMemo(() => {
    if (!isWebhookKind) return null
    if (webhookSelection) return webhookSelection
    if (!trigger?.triggerWebhookEndpointId) return null
    const match = webhookEndpointsQuery.data?.find((e) => e.id === trigger.triggerWebhookEndpointId)
    return {
      webhookEndpointId: trigger.triggerWebhookEndpointId,
      endpointName: match?.name ?? trigger.triggerWebhookEndpointId,
      endpointUrl: match?.url ?? '',
      hasTopicSource: !!match?.topicSource,
    }
  }, [isWebhookKind, webhookSelection, trigger, webhookEndpointsQuery.data])

  const { resources } = useResources()
  const fallbackEntityId = resources[0]?.id ?? 'ticket'

  const [confirm, ConfirmDialog] = useConfirm()
  const [scheduledState, setScheduledState] = useState<ScheduledState>(DEFAULT_SCHEDULED_STATE)
  const [eventState, setEventState] = useState<EventState>(DEFAULT_EVENT_STATE)
  const [appState, setAppState] = useState<AppState>(DEFAULT_APP_STATE)
  /** Free-text topic for the webhook-endpoint kind (matched against the delivery's extracted topic). */
  const [webhookTopic, setWebhookTopic] = useState('')
  const [instructions, setInstructions] = useState<TiptapDoc>(emptyPromptDoc)
  const [editorKey, setEditorKey] = useState(0)
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    if (trigger?.kind === 'scheduled') {
      setScheduledState(scheduledStateFromConfig(trigger.config as Record<string, unknown> | null))
    } else if (trigger?.kind === 'event') {
      setEventState(eventStateFromTrigger(trigger, fallbackEntityId))
    } else if (trigger?.kind === 'app') {
      setAppState(appStateFromTrigger(trigger))
    } else if (trigger?.kind === 'webhook-endpoint') {
      setWebhookTopic(trigger.triggerTopic ?? '')
    } else {
      setWebhookTopic('')
      setScheduledState(DEFAULT_SCHEDULED_STATE)
      setEventState({ ...DEFAULT_EVENT_STATE, entityDefinitionId: fallbackEntityId })
      setAppState({
        connectionId: null,
        userInputs: seedDefaults(readFieldNodes(appSelection?.inputsJsonSchema)),
      })
    }
    const raw = trigger?.instructions as unknown
    if (raw && typeof raw === 'object' && Array.isArray((raw as TiptapDoc).content)) {
      setInstructions(raw as TiptapDoc)
    } else {
      setInstructions(emptyPromptDoc())
    }
    setEditorKey((k) => k + 1)
  }, [open, trigger, fallbackEntityId, appSelection?.inputsJsonSchema])

  const setEventField = <K extends keyof EventState>(key: K, value: EventState[K]) =>
    setEventState((prev) => ({ ...prev, [key]: value }))

  const create = api.agentTrigger.create.useMutation({
    onSuccess: () => {
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (err) => toastError({ title: 'Failed to create trigger', description: err.message }),
  })

  const update = api.agentTrigger.update.useMutation({
    onSuccess: () => {
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (err) => toastError({ title: 'Failed to update trigger', description: err.message }),
  })

  const destroy = api.agentTrigger.delete.useMutation({
    onSuccess: () => {
      onSuccess?.()
      onOpenChange(false)
    },
    onError: (err) => toastError({ title: 'Failed to delete trigger', description: err.message }),
  })

  const isPending = create.isPending || update.isPending || destroy.isPending

  const handleDelete = async () => {
    if (!trigger) return
    const confirmed = await confirm({
      title: 'Delete trigger?',
      description: 'This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) destroy.mutate({ id: trigger.id })
  }

  // The source chip's Trash2 removes the binding: delete the row when editing, otherwise
  // abandon the in-progress selection (close the dialog). When the chip is shown it owns
  // delete, so the footer's Delete button steps aside for app / webhook kinds.
  const handleSourceRemove = () => {
    if (isEditMode) void handleDelete()
    else onOpenChange(false)
  }
  const chipHandlesDelete = (isAppKind && !!appContext) || (isWebhookKind && !!webhookContext)

  const fieldNodes = useMemo(
    () => readFieldNodes(appContext?.inputsJsonSchema),
    [appContext?.inputsJsonSchema]
  )

  const buildTriggerInput = () => {
    if (effectiveKind === 'scheduled') {
      const config = scheduledConfigFromState(scheduledState)
      if (!config) {
        toastError({ title: 'Custom cron is required' })
        return null
      }
      return { kind: 'scheduled' as const, config }
    }

    if (effectiveKind === 'mention') {
      return { kind: 'mention' as const }
    }
    if (effectiveKind === 'assignment') {
      return { kind: 'assignment' as const }
    }
    if (effectiveKind === 'dm') {
      return { kind: 'dm' as const }
    }

    if (effectiveKind === 'app') {
      if (!appContext || !appContext.appId || !appContext.triggerId || !appContext.installationId) {
        toastError({ title: 'App trigger metadata is missing' })
        return null
      }
      for (const { key, required, meta } of fieldNodes) {
        if (required && isMissing(appState.userInputs[key])) {
          toastError({ title: `"${meta.label ?? key}" is required` })
          return null
        }
      }
      return {
        kind: 'app' as const,
        triggerAppId: appContext.appId,
        triggerAppTriggerId: appContext.triggerId,
        triggerInstallationId: appContext.installationId,
        triggerConnectionId: appState.connectionId ?? undefined,
        userInputs: appState.userInputs,
      }
    }

    if (effectiveKind === 'webhook-endpoint') {
      if (!webhookContext || !webhookContext.webhookEndpointId) {
        toastError({ title: 'Pick a webhook endpoint' })
        return null
      }
      return {
        kind: 'webhook-endpoint' as const,
        triggerWebhookEndpointId: webhookContext.webhookEndpointId,
        triggerTopic: webhookTopic.trim(),
      }
    }

    if (!eventState.entityDefinitionId) {
      toastError({ title: 'Pick a resource' })
      return null
    }

    return {
      kind: 'event' as const,
      triggerType: eventState.triggerType,
      entityDefinitionId: eventState.entityDefinitionId,
    }
  }

  const handleSubmit = () => {
    const triggerInput = buildTriggerInput()
    if (!triggerInput) return

    const instructionsPayload = isNonEmptyDoc(instructions) ? instructions : null

    if (isEditMode && trigger) {
      update.mutate({
        id: trigger.id,
        trigger: triggerInput,
        instructions: instructionsPayload,
      })
      return
    }

    create.mutate({
      agentId,
      trigger: triggerInput,
      instructions: instructionsPayload,
    })
  }

  const selectedConnection = useMemo(() => {
    if (!appState.connectionId) return null
    return appConnections.find((c) => c.id === appState.connectionId) ?? null
  }, [appState.connectionId, appConnections])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='sm:max-w-[500px]' position='tc'>
          <DialogHeader>
            <DialogTitle>
              {isEditMode ? `Edit ${kindCopy.label} trigger` : `Add ${kindCopy.label} trigger`}
            </DialogTitle>
            <DialogDescription>{kindCopy.description}</DialogDescription>
          </DialogHeader>

          <div className='space-y-4'>
            {effectiveKind === 'scheduled' ? (
              <ScheduleEditor value={scheduledState} onChange={setScheduledState} />
            ) : effectiveKind === 'event' ? (
              <ResourceField
                title='Resource'
                description='Select the operation and type of resource for this trigger'>
                <VarEditorField className='px-0.5'>
                  <div className='flex flex-row'>
                    <div>
                      <Select
                        value={eventState.triggerType}
                        onValueChange={(v) => setEventField('triggerType', v as CrudTriggerType)}>
                        <SelectTrigger variant='outline' size='xs'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(RESOURCE_OPERATIONS).map(([key, config]) => (
                            <SelectItem key={key} value={key}>
                              {config.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='flex-1'>
                      <ResourcePicker
                        value={eventState.entityDefinitionId ? [eventState.entityDefinitionId] : []}
                        onChange={(selected) =>
                          setEventField('entityDefinitionId', selected[0] ?? '')
                        }
                        triggerProps={{ variant: 'transparent', className: 'w-full h-6 pe-2' }}
                        emptyLabel='Select resource...'
                      />
                    </div>
                  </div>
                </VarEditorField>
              </ResourceField>
            ) : effectiveKind === 'app' && appContext ? (
              <>
                <Field orientation='vertical'>
                  <FieldLabel>Trigger</FieldLabel>
                  <TriggerSourceRow
                    icon={<AppIcon iconId={appContext.appAvatarUrl ?? 'package'} size='sm' />}
                    title={`${appContext.appTitle} · ${appContext.triggerLabel}`}
                    secondary={appContext.triggerDescription}
                    onEdit={!isEditMode ? onRepick : undefined}
                    onDelete={handleSourceRemove}
                  />
                </Field>

                <Field orientation='vertical'>
                  <FieldLabel>Connection</FieldLabel>
                  <Popover open={accountPopoverOpen} onOpenChange={setAccountPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        className='w-full justify-between'>
                        {selectedConnection ? (
                          <span className='flex min-w-0 items-center gap-2'>
                            <AppIcon iconId={appContext.appAvatarUrl ?? 'package'} size='sm' />
                            <span className='truncate'>
                              {selectedConnection.label ?? selectedConnection.appName}
                            </span>
                          </span>
                        ) : (
                          <span className='truncate'>Any connection</span>
                        )}
                        <ChevronDown className='size-3.5 text-muted-foreground' />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='p-1 w-[--radix-popover-trigger-width]' align='start'>
                      <div className='space-y-1'>
                        <button
                          type='button'
                          className='flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-primary-100/80'
                          onClick={() => {
                            setAppState((prev) => ({ ...prev, connectionId: null }))
                            setAccountPopoverOpen(false)
                          }}>
                          Any connection
                        </button>
                        <AppAccountPicker
                          appId={appContext.appId}
                          value={appState.connectionId ?? undefined}
                          onPick={(credId) => {
                            setAppState((prev) => ({ ...prev, connectionId: credId }))
                            setAccountPopoverOpen(false)
                          }}
                          onConnected={(credId) => {
                            setAppState((prev) => ({ ...prev, connectionId: credId }))
                            setAccountPopoverOpen(false)
                          }}
                        />
                      </div>
                    </PopoverContent>
                  </Popover>
                </Field>

                {fieldNodes.length > 0 && (
                  <Field orientation='vertical'>
                    <FieldLabel>Inputs</FieldLabel>
                    <div className='space-y-3'>
                      {fieldNodes.map((entry) => (
                        <SchemaField
                          key={entry.key}
                          entry={entry}
                          value={appState.userInputs[entry.key]}
                          onChange={(next) =>
                            setAppState((prev) => ({
                              ...prev,
                              userInputs: { ...prev.userInputs, [entry.key]: next },
                            }))
                          }
                        />
                      ))}
                    </div>
                  </Field>
                )}
              </>
            ) : effectiveKind === 'webhook-endpoint' && webhookContext ? (
              <>
                <Field orientation='vertical'>
                  <FieldLabel>Trigger</FieldLabel>
                  <TriggerSourceRow
                    icon={<AppIcon iconId='webhook' size='sm' />}
                    title={webhookContext.endpointName}
                    secondary={webhookContext.endpointUrl}
                    onEdit={!isEditMode ? onRepick : undefined}
                    onDelete={handleSourceRemove}
                  />
                </Field>
                <Field orientation='vertical'>
                  <FieldLabel>Topic {webhookContext.hasTopicSource ? '' : '(optional)'}</FieldLabel>
                  <WebhookTopicPicker
                    endpointId={webhookContext.webhookEndpointId}
                    value={webhookTopic ? [webhookTopic] : []}
                    onChange={(keys) => setWebhookTopic(keys[0] ?? '')}
                    placeholder={
                      webhookContext.hasTopicSource ? 'Select or add a topic…' : 'Every delivery'
                    }
                  />
                </Field>
                <WebhookEndpointInspector
                  endpointId={webhookContext.webhookEndpointId}
                  topic={webhookTopic}
                  description='Live deliveries to this endpoint matching this trigger.'
                />
              </>
            ) : null}

            <Field orientation='vertical'>
              <FieldLabel>Instructions</FieldLabel>
              <div className='rounded-md flex flex-col border bg-background min-h-[160px] px-3 py-2'>
                <PromptEditor
                  key={editorKey}
                  initialContent={readPromptContent(instructions)}
                  onChange={({ json }) => setInstructions(json as TiptapDoc)}
                  referenceTabs={TEMPLATE_REFERENCE_TABS}
                  placeholderText='Write your instructions here'
                />
                <div className='flex text-sm gap-1 text-muted-foreground mt-2'>
                  Type <Kbd variant='outline'>@</Kbd> to specify tools or{' '}
                  <Kbd variant='outline'>/</Kbd> for formatting.
                </div>
              </div>
            </Field>
          </div>

          <DialogFooter className='flex sm:justify-between!'>
            {isEditMode && !isBuiltinKind && !chipHandlesDelete ? (
              <Button
                type='button'
                size='sm'
                variant='destructive-hover'
                onClick={handleDelete}
                disabled={isPending}>
                <Trash2 /> Delete
              </Button>
            ) : (
              <div />
            )}
            <div className='flex items-center gap-2'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => onOpenChange(false)}
                disabled={isPending}>
                Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              <Button
                onClick={handleSubmit}
                size='sm'
                variant='outline'
                loading={isPending}
                loadingText={isEditMode ? 'Updating...' : 'Adding...'}
                data-dialog-submit>
                {isEditMode ? 'Update trigger' : 'Add trigger'}{' '}
                <KbdSubmit variant='outline' size='sm' />
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}
