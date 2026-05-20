// apps/web/src/components/agents/ui/detail/triggers/agent-trigger-dialog.tsx
'use client'

import { isNonEmptyDoc, type TiptapDoc } from '@auxx/lib/tiptap'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Field, FieldLabel } from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
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
import { ChevronDown, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AppAccountPicker } from '~/components/apps/ui/app-account-picker'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { DEFAULT_TABS } from '~/components/editor/inline-picker'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import { PromptEditor } from '~/components/editor/prompt-editor'
import { ResourcePicker } from '~/components/pickers/resource-picker'
import { useResources } from '~/components/resources/hooks/use-resources'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { useConfirm } from '~/hooks/use-confirm'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
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
  app: {
    label: 'app',
    description: 'Fire this agent when an installed app emits a trigger event.',
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

type Kind = 'scheduled' | 'event' | 'app' | 'mention' | 'assignment' | 'dm'
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

interface AppState {
  /** `null` means "any connection". */
  connectionId: string | null
  userInputs: Record<string, unknown>
}

const DEFAULT_APP_STATE: AppState = {
  connectionId: null,
  userInputs: {},
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

function appStateFromTrigger(trigger: Trigger): AppState {
  const config = (trigger.config as Record<string, unknown> | null) ?? {}
  const userInputsRaw = (config.userInputs as Record<string, unknown> | undefined) ?? {}
  return {
    connectionId: trigger.triggerConnectionId ?? null,
    userInputs: { ...userInputsRaw },
  }
}

interface SelectOption {
  value: string
  label: string
}

interface FieldNodeMetadata {
  label?: string
  description?: string
  placeholder?: string
  multi?: boolean
  defaultValue?: unknown
  options?: SelectOption[]
}

interface FieldNode {
  type: string
  isOptional?: boolean
  _metadata?: FieldNodeMetadata
}

interface FieldEntry {
  key: string
  node: FieldNode
  meta: FieldNodeMetadata
  required: boolean
}

function readFieldNodes(schema: Record<string, unknown> | null | undefined): FieldEntry[] {
  if (!schema) return []
  const entries: FieldEntry[] = []
  for (const [key, raw] of Object.entries(schema)) {
    if (!raw || typeof raw !== 'object') continue
    const node = raw as FieldNode
    if (typeof node.type !== 'string') continue
    const meta = node._metadata ?? {}
    entries.push({ key, node, meta, required: node.isOptional !== true })
  }
  return entries
}

function isMissing(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

function seedDefaults(fields: FieldEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const { key, meta } of fields) {
    if (meta.defaultValue !== undefined) {
      out[key] = meta.defaultValue
    }
  }
  return out
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
  onSuccess,
}: AgentTriggerDialogProps) {
  const isEditMode = !!trigger
  const effectiveKind: Kind = isEditMode && trigger ? (trigger.kind as Kind) : kind
  const kindCopy = KIND_COPY[effectiveKind]
  const isBuiltinKind =
    effectiveKind === 'mention' || effectiveKind === 'assignment' || effectiveKind === 'dm'
  const isAppKind = effectiveKind === 'app'

  const { appInstallations, appConnections } = useExtensionsContext()

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

  const { resources } = useResources()
  const fallbackEntityId = resources[0]?.id ?? 'ticket'

  const [confirm, ConfirmDialog] = useConfirm()
  const [scheduledState, setScheduledState] = useState<ScheduledState>(DEFAULT_SCHEDULED_STATE)
  const [eventState, setEventState] = useState<EventState>(DEFAULT_EVENT_STATE)
  const [appState, setAppState] = useState<AppState>(DEFAULT_APP_STATE)
  const [instructions, setInstructions] = useState<TiptapDoc>(emptyPromptDoc)
  const [editorKey, setEditorKey] = useState(0)
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    if (trigger?.kind === 'scheduled') {
      setScheduledState(scheduledFromTrigger(trigger))
    } else if (trigger?.kind === 'event') {
      setEventState(eventStateFromTrigger(trigger, fallbackEntityId))
    } else if (trigger?.kind === 'app') {
      setAppState(appStateFromTrigger(trigger))
    } else {
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

  const fieldNodes = useMemo(
    () => readFieldNodes(appContext?.inputsJsonSchema),
    [appContext?.inputsJsonSchema]
  )

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
                  <div className='flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2'>
                    <AppIcon
                      iconId={appContext.appAvatarUrl ?? 'package'}
                      size='lg'
                      className='border border-foreground/5'
                    />
                    <div className='flex min-w-0 flex-col'>
                      <span className='truncate text-sm font-medium'>
                        {appContext.appTitle} · {appContext.triggerLabel}
                      </span>
                      {appContext.triggerDescription && (
                        <span className='truncate text-xs text-muted-foreground'>
                          {appContext.triggerDescription}
                        </span>
                      )}
                    </div>
                  </div>
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
                        <AppInputField
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

interface AppInputFieldProps {
  entry: FieldEntry
  value: unknown
  onChange: (next: unknown) => void
}

function AppInputField({ entry, value, onChange }: AppInputFieldProps) {
  const { key, node, meta, required } = entry
  const inputId = `app-input-${key}`
  const label = meta.label ?? key

  const labelEl = (
    <label className='text-xs text-muted-foreground' htmlFor={inputId}>
      {label}
      {required && <span className='text-red-500'>*</span>}
    </label>
  )

  if (node.type === 'select') {
    const options = meta.options ?? []
    if (meta.multi) {
      const selected = Array.isArray(value) ? (value as string[]) : []
      const toggle = (optionValue: string, checked: boolean) => {
        onChange(checked ? [...selected, optionValue] : selected.filter((v) => v !== optionValue))
      }
      return (
        <div className='flex flex-col gap-1.5'>
          {labelEl}
          {options.length === 0 ? (
            <span className='text-xs text-muted-foreground'>No options available.</span>
          ) : (
            <div className='space-y-1.5 rounded-md border bg-background px-3 py-2'>
              {options.map((option) => {
                const optionId = `${inputId}-${option.value}`
                const checked = selected.includes(option.value)
                return (
                  <div key={option.value} className='flex items-center gap-2'>
                    <Checkbox
                      id={optionId}
                      checked={checked}
                      onCheckedChange={(next) => toggle(option.value, next === true)}
                    />
                    <label htmlFor={optionId} className='text-sm'>
                      {option.label}
                    </label>
                  </div>
                )
              })}
            </div>
          )}
          {meta.description && (
            <span className='text-xs text-muted-foreground'>{meta.description}</span>
          )}
        </div>
      )
    }
    if (options.length === 0) {
      return (
        <div className='flex flex-col gap-1'>
          {labelEl}
          <Input
            id={inputId}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={meta.placeholder}
          />
          {meta.description && (
            <span className='text-xs text-muted-foreground'>{meta.description}</span>
          )}
        </div>
      )
    }
    return (
      <div className='flex flex-col gap-1'>
        {labelEl}
        <Select value={typeof value === 'string' ? value : ''} onValueChange={(v) => onChange(v)}>
          <SelectTrigger id={inputId} size='sm'>
            <SelectValue placeholder={meta.placeholder ?? 'Select...'} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {meta.description && (
          <span className='text-xs text-muted-foreground'>{meta.description}</span>
        )}
      </div>
    )
  }

  if (node.type === 'boolean') {
    const checked = value === true
    return (
      <div className='flex items-start gap-2'>
        <Checkbox
          id={inputId}
          checked={checked}
          onCheckedChange={(next) => onChange(next === true)}
        />
        <div className='flex flex-col gap-0.5'>
          <label htmlFor={inputId} className='text-sm'>
            {label}
            {required && <span className='text-red-500'>*</span>}
          </label>
          {meta.description && (
            <span className='text-xs text-muted-foreground'>{meta.description}</span>
          )}
        </div>
      </div>
    )
  }

  if (node.type === 'number') {
    return (
      <div className='flex flex-col gap-1'>
        {labelEl}
        <Input
          id={inputId}
          type='number'
          value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              onChange(undefined)
              return
            }
            const parsed = Number(raw)
            onChange(Number.isNaN(parsed) ? raw : parsed)
          }}
          placeholder={meta.placeholder}
        />
        {meta.description && (
          <span className='text-xs text-muted-foreground'>{meta.description}</span>
        )}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-1'>
      {labelEl}
      <Input
        id={inputId}
        value={typeof value === 'string' ? value : value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={meta.placeholder}
      />
      {meta.description && (
        <span className='text-xs text-muted-foreground'>{meta.description}</span>
      )}
    </div>
  )
}
