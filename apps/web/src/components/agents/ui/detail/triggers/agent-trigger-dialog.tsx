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
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
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
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DEFAULT_TABS } from '~/components/editor/inline-picker'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import { PromptEditor } from '~/components/editor/prompt-editor'
import { ResourcePicker } from '~/components/pickers/resource-picker'
import { useResources } from '~/components/resources/hooks/use-resources'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'
import { TriggerCronEditor } from './trigger-cron-editor'
import { type Interval, TriggerIntervalSelector } from './trigger-interval-selector'

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

type Kind = 'scheduled' | 'event' | 'mention' | 'assignment' | 'dm'
type ScheduledMode = 'simple' | 'cron'
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
  onSuccess?: () => void
}

interface ScheduledState {
  mode: ScheduledMode
  interval: Interval
  value: number
  customCron: string
}

const DEFAULT_SCHEDULED_STATE: ScheduledState = {
  mode: 'simple',
  interval: 'hours',
  value: 1,
  customCron: '',
}

interface EventState {
  triggerType: CrudTriggerType
  entityDefinitionId: string
}

const DEFAULT_EVENT_STATE: EventState = {
  triggerType: 'created',
  entityDefinitionId: 'ticket',
}

function scheduledFromTrigger(trigger: Trigger): ScheduledState {
  const config = (trigger.config as Record<string, unknown> | null) ?? {}
  const triggerInterval = (config.triggerInterval as Interval | 'custom') ?? 'hours'
  if (triggerInterval === 'custom') {
    return {
      ...DEFAULT_SCHEDULED_STATE,
      mode: 'cron',
      customCron: (config.customCron as string) ?? '',
    }
  }
  const timeBetween = (config.timeBetweenTriggers as Record<string, number | string>) ?? {}
  const rawValue = timeBetween[triggerInterval]
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue) || 1
  return {
    ...DEFAULT_SCHEDULED_STATE,
    mode: 'simple',
    interval: triggerInterval,
    value,
  }
}

function eventStateFromTrigger(trigger: Trigger, fallbackEntityId: string): EventState {
  return {
    triggerType: (trigger.triggerType as CrudTriggerType) ?? 'created',
    entityDefinitionId: trigger.entityDefinitionId ?? fallbackEntityId,
  }
}

/**
 * Dialog for creating or editing an agent trigger. The `kind` is selected
 * upstream (from the section-header dropdown) and is immutable in this
 * dialog. `app` triggers cannot be edited here.
 */
export function AgentTriggerDialog({
  open,
  onOpenChange,
  agentId,
  kind,
  trigger,
  onSuccess,
}: AgentTriggerDialogProps) {
  const isEditMode = !!trigger
  const isAppKind = trigger?.kind === 'app'
  const effectiveKind: Kind =
    isEditMode && trigger && trigger.kind !== 'app' ? (trigger.kind as Kind) : kind
  const kindCopy = KIND_COPY[effectiveKind]
  const isBuiltinKind =
    effectiveKind === 'mention' || effectiveKind === 'assignment' || effectiveKind === 'dm'

  const { resources } = useResources()
  const fallbackEntityId = resources[0]?.id ?? 'ticket'

  const [confirm, ConfirmDialog] = useConfirm()
  const [scheduledState, setScheduledState] = useState<ScheduledState>(DEFAULT_SCHEDULED_STATE)
  const [eventState, setEventState] = useState<EventState>(DEFAULT_EVENT_STATE)
  const [instructions, setInstructions] = useState<TiptapDoc>(emptyPromptDoc)
  const [editorKey, setEditorKey] = useState(0)

  useEffect(() => {
    if (!open) return
    if (trigger?.kind === 'scheduled') {
      setScheduledState(scheduledFromTrigger(trigger))
    } else if (trigger?.kind === 'event') {
      setEventState(eventStateFromTrigger(trigger, fallbackEntityId))
    } else {
      setScheduledState(DEFAULT_SCHEDULED_STATE)
      setEventState({ ...DEFAULT_EVENT_STATE, entityDefinitionId: fallbackEntityId })
    }
    const raw = trigger?.instructions as unknown
    if (raw && typeof raw === 'object' && Array.isArray((raw as TiptapDoc).content)) {
      setInstructions(raw as TiptapDoc)
    } else {
      setInstructions(emptyPromptDoc())
    }
    setEditorKey((k) => k + 1)
  }, [open, trigger, fallbackEntityId])

  const setScheduledMode = (mode: ScheduledMode) =>
    setScheduledState((prev) => ({
      ...prev,
      mode,
      customCron: mode === 'cron' ? prev.customCron || '0 * * * *' : prev.customCron,
    }))

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

  const buildTriggerInput = () => {
    if (effectiveKind === 'scheduled') {
      if (scheduledState.mode === 'cron') {
        if (!scheduledState.customCron.trim()) {
          toastError({ title: 'Custom cron is required' })
          return null
        }
        return {
          kind: 'scheduled' as const,
          config: {
            triggerInterval: 'custom' as const,
            timeBetweenTriggers: {},
            customCron: scheduledState.customCron,
          },
        }
      }
      return {
        kind: 'scheduled' as const,
        config: {
          triggerInterval: scheduledState.interval,
          timeBetweenTriggers: {
            [scheduledState.interval]: scheduledState.value,
            isConstant: true,
          },
        },
      }
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

          {isAppKind ? (
            <div className='rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground'>
              App triggers can't be edited here. Manage them from the app catalog.
            </div>
          ) : (
            <div className='space-y-4'>
              {effectiveKind === 'scheduled' ? (
                <>
                  <Field orientation='horizontal'>
                    <FieldLabel>Mode</FieldLabel>
                    <RadioTab
                      value={scheduledState.mode}
                      onValueChange={(v) => setScheduledMode(v as ScheduledMode)}
                      size='sm'>
                      <RadioTabItem value='simple' size='sm'>
                        Simple
                      </RadioTabItem>
                      <RadioTabItem value='cron' size='sm'>
                        Cron
                      </RadioTabItem>
                    </RadioTab>
                  </Field>

                  {scheduledState.mode === 'cron' ? (
                    <TriggerCronEditor
                      value={scheduledState.customCron}
                      onChange={(customCron) =>
                        setScheduledState((prev) => ({ ...prev, customCron }))
                      }
                    />
                  ) : (
                    <TriggerIntervalSelector
                      interval={scheduledState.interval}
                      value={scheduledState.value}
                      onIntervalChange={(interval) =>
                        setScheduledState((prev) => ({ ...prev, interval }))
                      }
                      onValueChange={(value) => setScheduledState((prev) => ({ ...prev, value }))}
                    />
                  )}
                </>
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
                          value={
                            eventState.entityDefinitionId ? [eventState.entityDefinitionId] : []
                          }
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
          )}

          <DialogFooter className='flex sm:justify-between!'>
            {isEditMode && !isBuiltinKind ? (
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
                disabled={isAppKind}
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
