// apps/web/src/components/agents/ui/detail/triggers/agent-trigger-dialog.tsx
'use client'

import { docToText, textToDoc } from '@auxx/lib/tiptap'
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
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ResourcePicker } from '~/components/pickers/resource-picker'
import { useResources } from '~/components/resources/hooks/use-resources'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'
import { TriggerCronEditor } from './trigger-cron-editor'
import { type Interval, TriggerIntervalSelector } from './trigger-interval-selector'

type Trigger = RouterOutputs['agentTrigger']['list'][number]

type Kind = 'scheduled' | 'event' | 'mention' | 'assignment'
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
  const effectiveKind: Kind = isEditMode
    ? trigger?.kind === 'event'
      ? 'event'
      : trigger?.kind === 'mention'
        ? 'mention'
        : trigger?.kind === 'assignment'
          ? 'assignment'
          : 'scheduled'
    : kind
  const isInstructionsOnly = effectiveKind === 'mention' || effectiveKind === 'assignment'

  const { resources } = useResources()
  const fallbackEntityId = resources[0]?.id ?? 'ticket'

  const [confirm, ConfirmDialog] = useConfirm()
  const [scheduledState, setScheduledState] = useState<ScheduledState>(DEFAULT_SCHEDULED_STATE)
  const [eventState, setEventState] = useState<EventState>(DEFAULT_EVENT_STATE)
  const [instructionsText, setInstructionsText] = useState<string>('')

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
    // Hydrate Instructions from the JSONB column (string or Tiptap doc).
    const raw = trigger?.instructions as unknown
    if (typeof raw === 'string') {
      setInstructionsText(raw)
    } else if (raw && typeof raw === 'object') {
      setInstructionsText(docToText(raw))
    } else {
      setInstructionsText('')
    }
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

    const trimmedInstructions = instructionsText.trim()
    const instructions =
      isInstructionsOnly && trimmedInstructions ? textToDoc(trimmedInstructions) : undefined

    if (isEditMode && trigger) {
      update.mutate({
        id: trigger.id,
        trigger: triggerInput,
        ...(isInstructionsOnly ? { instructions } : {}),
      })
      return
    }

    create.mutate({
      agentId,
      trigger: triggerInput,
      ...(isInstructionsOnly && instructions ? { instructions } : {}),
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='sm:max-w-[500px]' position='tc'>
          <DialogHeader>
            <DialogTitle>
              {isEditMode ? `Edit ${effectiveKind} trigger` : `Add ${effectiveKind} trigger`}
            </DialogTitle>
            <DialogDescription>
              {effectiveKind === 'scheduled'
                ? 'Fire this agent on a recurring schedule.'
                : effectiveKind === 'mention'
                  ? 'Fire this agent when it is mentioned in a comment.'
                  : effectiveKind === 'assignment'
                    ? 'Fire this agent when it is assigned to a ticket.'
                    : 'Fire this agent when a resource is created, updated, or deleted.'}
            </DialogDescription>
          </DialogHeader>

          {isAppKind ? (
            <div className='rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground'>
              App triggers can't be edited here. Manage them from the app catalog.
            </div>
          ) : isInstructionsOnly ? (
            <div className='space-y-2'>
              <Field orientation='vertical'>
                <FieldLabel>Instructions</FieldLabel>
                <textarea
                  value={instructionsText}
                  onChange={(e) => setInstructionsText(e.target.value)}
                  rows={6}
                  placeholder='Optional. Layered on top of the agent prompt when this trigger fires.'
                  className='w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                />
              </Field>
            </div>
          ) : effectiveKind === 'scheduled' ? (
            <div className='space-y-4'>
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
                  onChange={(customCron) => setScheduledState((prev) => ({ ...prev, customCron }))}
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
            </div>
          ) : (
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
          )}

          <DialogFooter className='flex sm:justify-between!'>
            {isEditMode && !isInstructionsOnly ? (
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
