// apps/web/src/components/mail/email-editor/quick-action-panel.tsx

'use client'

import type { DraftActionPayload } from '@auxx/lib/quick-actions/client'
import {
  SELECT_OPTION_COLORS,
  type SelectOption,
  type SelectOptionColor,
} from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@auxx/ui/components/collapsible'
import { Combobox } from '@auxx/ui/components/combobox'
import { Input } from '@auxx/ui/components/input'
import {
  CurrencyInputField,
  CurrencyInput as CurrencyInputUi,
} from '@auxx/ui/components/input-currency'
import { InputGroup } from '@auxx/ui/components/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Switch } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight, X, Zap } from 'lucide-react'
import type React from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useActionCatalog } from '~/components/apps/hooks/use-action-catalog'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { AsyncOptionPicker } from '~/components/pickers/async-option-picker'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import type { SerializedQuickAction } from '~/components/workflow/apps/workflow-block-loader'
import { useQuickActions } from '~/hooks/use-quick-actions'
import { api } from '~/trpc/react'

interface QuickActionPanelProps {
  actions: DraftActionPayload[]
  onAdd: (action: DraftActionPayload) => void
  onRemove: (actionId: string) => void
  onUpdate: (actionId: string, inputs: Record<string, unknown>) => void
  threadId?: string
  ticketId?: string
  /** The thread's primary contact record id (`contact:<instanceId>`), if known.
   * Dynamic-select inputs bind their options against it. */
  contactRecordId?: string | null
  disabled?: boolean
  popoverClassName?: string
  onPopoverOpenChange?: (open: boolean) => void
}

export function QuickActionPanel({
  actions,
  onRemove,
  onUpdate,
  disabled,
  threadId,
  ticketId,
  contactRecordId,
  popoverClassName,
  onPopoverOpenChange,
}: QuickActionPanelProps) {
  // Resolve each chip's input schema from the LIVE installed-app catalog rather
  // than a module cache populated at add-time. This survives reloads / restored
  // drafts: a chip rehydrated from a saved draft still finds its schema here,
  // keyed by `appId:actionId`, with no dependency on the add flow having run
  // this session. An uninstalled app's action resolves to `undefined` (no
  // schema to edit) — correct; the chip just isn't expandable.
  const { actions: availableActions } = useQuickActions(threadId, ticketId)
  const schemaByKey = useMemo(() => {
    const map = new Map<string, { inputs: Record<string, any> }>()
    for (const a of availableActions) {
      if (a.inputs && Object.keys(a.inputs).length > 0) {
        map.set(`${a.appId}:${a.id}`, { inputs: a.inputs })
      }
    }
    return map
  }, [availableActions])

  if (actions.length === 0) return null

  return (
    <div className='mx-4 mb-2 mt-1'>
      <div className='flex flex-col gap-1.5'>
        <span className='flex items-center gap-1 text-xs text-muted-foreground'>
          <Zap className='size-3' />
          Actions
        </span>

        <div className='flex flex-wrap items-start gap-1.5'>
          {actions.map((action) => (
            <QuickActionChip
              key={`${action.appId}:${action.actionId}`}
              action={action}
              schema={schemaByKey.get(`${action.appId}:${action.actionId}`)}
              contactRecordId={contactRecordId}
              onRemove={() => onRemove(action.actionId)}
              onUpdate={onUpdate}
              disabled={disabled}
              popoverClassName={popoverClassName}
              onPopoverOpenChange={onPopoverOpenChange}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function QuickActionChip({
  action,
  schema,
  contactRecordId,
  onRemove,
  onUpdate,
  disabled,
  popoverClassName,
  onPopoverOpenChange,
}: {
  action: DraftActionPayload
  schema?: { inputs: Record<string, any> }
  contactRecordId?: string | null
  onRemove: () => void
  onUpdate: (actionId: string, inputs: Record<string, unknown>) => void
  disabled?: boolean
  popoverClassName?: string
  onPopoverOpenChange?: (open: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div
        className={cn(
          'group inline-flex flex-col rounded-md border bg-muted/50 text-xs',
          disabled && 'opacity-50'
        )}>
        {/* Header row: the trigger and the remove control are siblings. The
            remove <button> must NOT nest inside the trigger's <button> —
            that's invalid HTML and triggers a hydration error that kills all
            chip interactivity (expand + remove both stop working). */}
        <div className='inline-flex items-center'>
          <CollapsibleTrigger
            disabled={!schema || disabled}
            className={cn(
              'inline-flex items-center gap-1 py-1 pl-2',
              disabled ? 'pr-2' : 'pr-1',
              schema && !disabled && 'cursor-pointer'
            )}>
            {schema && (
              <span className='size-3 shrink-0 text-muted-foreground'>
                {expanded ? (
                  <ChevronDown className='size-3' />
                ) : (
                  <ChevronRight className='size-3' />
                )}
              </span>
            )}

            {action.display.color && (
              <span
                className='size-2 shrink-0 rounded-full'
                style={{ backgroundColor: action.display.color }}
              />
            )}

            <span className='max-w-48 truncate font-medium'>
              {action.display.summary || action.display.label}
            </span>
          </CollapsibleTrigger>

          {!disabled && (
            <button
              type='button'
              className='mr-2 ml-0.5 opacity-0 transition-opacity group-hover:opacity-100'
              onClick={() => onRemove()}>
              <X className='size-3' />
            </button>
          )}
        </div>

        {schema && (
          <CollapsibleContent className='overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down'>
            <div className='px-2 pb-1.5 opacity-0 transition-opacity duration-200 delay-100 [[data-state=open]_&]:opacity-100 [[data-state=closed]_&]:opacity-0 [[data-state=closed]_&]:delay-0'>
              <QuickActionForm
                fields={schema.inputs}
                values={action.inputs}
                onChange={(inputs) => onUpdate(action.actionId, inputs)}
                appId={action.appId}
                installationId={action.installationId}
                actionId={action.actionId}
                contactRecordId={contactRecordId}
                disabled={disabled}
                popoverClassName={popoverClassName}
                onPopoverOpenChange={onPopoverOpenChange}
              />
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  )
}

interface AddActionButtonProps {
  threadId?: string
  ticketId?: string
  currentActions: DraftActionPayload[]
  onAdd: (action: DraftActionPayload) => void
  onRemove: (actionId: string) => void
  disabled?: boolean
  popoverClassName?: string
  onOpenChange?: (open: boolean) => void
}

export function AddActionButton({
  threadId,
  ticketId,
  currentActions,
  onAdd,
  onRemove,
  disabled,
  popoverClassName,
  onOpenChange,
}: AddActionButtonProps) {
  const [open, setOpen] = useState(false)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          size='xs'
          disabled={disabled}
          className='h-6 gap-1 text-xs text-muted-foreground/50'>
          <Zap className='size-3' />
          Add action
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className={cn('w-64 p-0', popoverClassName)}>
        <QuickActionPicker
          threadId={threadId}
          ticketId={ticketId}
          currentActions={currentActions}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      </PopoverContent>
    </Popover>
  )
}

function QuickActionPicker({
  threadId,
  ticketId,
  currentActions,
  onAdd,
  onRemove,
}: {
  threadId?: string
  ticketId?: string
  currentActions: DraftActionPayload[]
  onAdd: (action: DraftActionPayload) => void
  onRemove: (actionId: string) => void
}) {
  const { actions, groups, isLoading } = useActionCatalog()

  // One option per action; the action's own icon (raw key) sits on the row, the
  // app icon lands on the group heading. Group headings are keyed by app id.
  const options: SelectOption[] = useMemo(
    () =>
      actions.map((a) => ({
        value: a.id,
        label: a.label,
        // App manifests may carry any colour string; `SelectOption` only
        // renders the named palette, so anything else drops to no colour.
        color: SELECT_OPTION_COLORS.includes(a.color as SelectOptionColor)
          ? (a.color as SelectOptionColor)
          : undefined,
        icon: a.icon,
      })),
    [actions]
  )

  const optionGroups = useMemo(
    () =>
      groups.map((g) => ({
        id: g.app.id,
        heading: (
          <span className='flex items-center gap-1.5'>
            <AppIcon iconId={g.app.iconId} color={g.app.color ?? undefined} size='sm' />
            {g.app.title}
          </span>
        ),
      })),
    [groups]
  )

  // Map each option value (toolId) back to its owning app for `groupBy`.
  const appIdByValue = useMemo(() => new Map(actions.map((a) => [a.id, a.appId])), [actions])

  const selectedIds = useMemo(() => currentActions.map((a) => a.actionId), [currentActions])

  // Build a lookup map for constructing DraftActionPayload on add
  const actionMap = useMemo(() => new Map(actions.map((a) => [a.id, a])), [actions])

  const handleChange = useCallback(
    (newSelectedIds: string[]) => {
      const prevSet = new Set(selectedIds)
      const nextSet = new Set(newSelectedIds)

      // Handle additions
      for (const id of newSelectedIds) {
        if (!prevSet.has(id)) {
          const action = actionMap.get(id)
          if (!action) continue
          onAdd(toDraftActionPayload(action))
        }
      }

      // Handle removals
      for (const id of selectedIds) {
        if (!nextSet.has(id)) {
          onRemove(id)
        }
      }
    },
    [selectedIds, actionMap, onAdd, onRemove]
  )

  if (!isLoading && actions.length === 0) {
    return (
      <div className='py-4 text-center text-xs text-muted-foreground'>
        No quick actions available.
        <br />
        Install apps with quick actions to get started.
      </div>
    )
  }

  return (
    <MultiSelectPicker
      options={options}
      value={selectedIds}
      onChange={handleChange}
      groupBy={(opt) => appIdByValue.get(opt.value) ?? ''}
      groups={optionGroups}
      placeholder='Search actions...'
      canManage={false}
      canAdd={false}
      isLoading={isLoading}
    />
  )
}

/**
 * Build the draft-level payload for a selected quick action. Shared by the
 * belowEditor picker and the mail `@` menu so both mint byte-identical payloads.
 * Input schemas are resolved at render time from the live catalog (see
 * `QuickActionPanel`), so adding an action carries no schema-caching step.
 */
export function toDraftActionPayload(action: SerializedQuickAction): DraftActionPayload {
  return {
    appId: action.appId!,
    installationId: action.installationId!,
    actionId: action.id,
    inputs: action.defaults ?? {},
    display: {
      label: action.label,
      icon: action.icon,
      color: action.color,
      summary: action.label,
    },
  }
}

// ===== QuickActionForm =====

function QuickActionForm({
  fields,
  values,
  onChange,
  appId,
  installationId,
  actionId,
  contactRecordId,
  disabled,
  popoverClassName,
  onPopoverOpenChange,
}: {
  fields: Record<string, any>
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  appId: string
  installationId: string
  actionId: string
  contactRecordId?: string | null
  disabled?: boolean
  popoverClassName?: string
  onPopoverOpenChange?: (open: boolean) => void
}) {
  const entries = Object.entries(fields)
  if (entries.length === 0) return null

  return (
    <div className='flex flex-col gap-1.5 border-t pt-1.5'>
      {entries.map(([key, field]) => (
        <QuickActionField
          key={key}
          fieldKey={key}
          field={field}
          value={values[key]}
          onChange={(v) => onChange({ ...values, [key]: v })}
          appId={appId}
          installationId={installationId}
          actionId={actionId}
          contactRecordId={contactRecordId}
          disabled={disabled}
          popoverClassName={popoverClassName}
          onPopoverOpenChange={onPopoverOpenChange}
        />
      ))}
    </div>
  )
}

function QuickActionField({
  fieldKey,
  field,
  value,
  onChange,
  appId,
  installationId,
  actionId,
  contactRecordId,
  disabled,
  popoverClassName,
  onPopoverOpenChange,
}: {
  fieldKey: string
  field: any
  value: unknown
  onChange: (value: unknown) => void
  appId: string
  installationId: string
  actionId: string
  contactRecordId?: string | null
  disabled?: boolean
  popoverClassName?: string
  onPopoverOpenChange?: (open: boolean) => void
}) {
  const label = field.label || fieldKey

  switch (field.type) {
    case 'dynamic-select':
      return (
        <QuickActionDynamicSelectField
          label={label}
          value={(value as string) ?? ''}
          onChange={onChange}
          appId={appId}
          installationId={installationId}
          actionId={actionId}
          fieldKey={fieldKey}
          contactRecordId={contactRecordId}
          emptyHint={field.dynamicSelect?.emptyHint}
          placeholder={field.placeholder}
          disabled={disabled}
          popoverClassName={popoverClassName}
          onPopoverOpenChange={onPopoverOpenChange}
        />
      )

    case 'string':
      return (
        <div className='flex items-center gap-2'>
          <label className='min-w-16 shrink-0 text-xs text-muted-foreground'>{label}</label>
          <Input
            className='h-6 text-xs'
            placeholder={field.placeholder}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        </div>
      )

    case 'number':
      return (
        <div className='flex items-center gap-2'>
          <label className='min-w-16 shrink-0 text-xs text-muted-foreground'>{label}</label>
          <Input
            type='number'
            className='h-6 text-xs'
            placeholder={field.placeholder}
            min={field.min}
            max={field.max}
            step={field.integer ? 1 : field.precision ? 10 ** -field.precision : undefined}
            value={(value as number) ?? ''}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
            disabled={disabled}
          />
        </div>
      )

    case 'currency':
      return (
        <QuickActionCurrencyField
          label={label}
          value={value as number | undefined}
          onChange={onChange}
          disabled={disabled}
          currencyCode={field._metadata?.currencyCode ?? 'USD'}
          decimalPlaces={field._metadata?.decimalPlaces}
          placeholder={field.placeholder}
        />
      )

    case 'boolean':
      return (
        <div className='flex items-center gap-2'>
          <label className='min-w-16 shrink-0 text-xs text-muted-foreground'>{label}</label>
          <Switch
            checked={!!value}
            onCheckedChange={(checked) => onChange(checked)}
            disabled={disabled}
          />
        </div>
      )

    case 'select':
      return (
        <div className='flex items-center gap-2'>
          <label className='min-w-16 shrink-0 text-xs text-muted-foreground'>{label}</label>
          <Combobox
            options={(field.options ?? []).map((opt: any) => ({
              value: opt.value,
              label: opt.label || opt.value,
            }))}
            placeholder={field.placeholder || 'Select...'}
            emptyText='No options'
            value={(value as string) ?? ''}
            onChangeValue={(v) => onChange(v)}
            disabled={disabled}
            variant='outline'
            size='sm'
            className='h-6 text-xs'
            popoverClassName={popoverClassName}
            onOpenChange={onPopoverOpenChange}
          />
        </div>
      )

    default:
      // Fallback for unsupported field types
      if (value !== undefined && value !== null) {
        return (
          <div className='flex items-center gap-2'>
            <label className='min-w-16 shrink-0 text-xs text-muted-foreground'>{label}</label>
            <pre className='text-xs text-muted-foreground'>{JSON.stringify(value)}</pre>
          </div>
        )
      }
      return null
  }
}

/**
 * A select whose options are loaded at open time from `apps.resolveToolOptions`
 * — the app's resolver tool run against the thread's contact. When no contact is
 * linked or zero options resolve, the control renders disabled with the hint
 * (decision 6 — show, don't hide). See plans/actions/09-dynamic-action-inputs.md.
 */
function QuickActionDynamicSelectField({
  label,
  value,
  onChange,
  appId,
  installationId,
  actionId,
  fieldKey,
  contactRecordId,
  emptyHint,
  placeholder,
  disabled,
  popoverClassName,
  onPopoverOpenChange,
}: {
  label: string
  value: string
  onChange: (value: unknown) => void
  appId: string
  installationId: string
  actionId: string
  fieldKey: string
  contactRecordId?: string | null
  emptyHint?: string
  placeholder?: string
  disabled?: boolean
  popoverClassName?: string
  onPopoverOpenChange?: (open: boolean) => void
}) {
  const [opened, setOpened] = useState(false)
  // Fetch when the picker is opened, or up-front when a value is already stored
  // (so we can render its label). Cached for the compose session — charges don't
  // change mid-compose, so re-opening doesn't re-invoke the lambda.
  const enabled = !!contactRecordId && (opened || !!value)
  const optionsQuery = api.apps.resolveToolOptions.useQuery(
    {
      source: {
        kind: 'entity',
        appId,
        installationId,
        actionId,
        recordId: contactRecordId ?? '',
      },
      fieldKey,
    },
    { enabled, staleTime: 60_000, refetchOnWindowFocus: false }
  )

  const resolved = optionsQuery.data?.options ?? []
  const comboOptions: SelectOption[] = resolved.map((o) => ({
    value: o.value,
    label: o.sublabel ? `${o.label} — ${o.sublabel}` : o.label,
  }))

  const noOptions = enabled && !optionsQuery.isLoading && resolved.length === 0
  const hintText =
    (!contactRecordId ? emptyHint : optionsQuery.data?.disabledHint) ??
    emptyHint ??
    'No options available'
  // Disabled when there's nothing to pick (no contact, or resolved empty) and no
  // value already chosen.
  const isDisabled = disabled || ((!contactRecordId || noOptions) && !value)

  return (
    <div className='flex items-center gap-2'>
      <label className='min-w-16 shrink-0 text-xs text-muted-foreground'>{label}</label>
      <AsyncOptionPicker
        staticOptions={comboOptions}
        isLoading={optionsQuery.isLoading}
        value={value}
        onChange={(selected) => onChange(selected[0] || undefined)}
        multi={false}
        disabled={isDisabled}
        placeholder={isDisabled ? hintText : placeholder || 'Select...'}
        searchPlaceholder='Search…'
        triggerProps={{
          variant: 'outline',
          size: 'sm',
          className: 'h-6 text-xs',
          showClear: false,
        }}
        className='flex-1'
        popoverClassName={popoverClassName}
        onOpenChange={(o) => {
          if (o) setOpened(true)
          onPopoverOpenChange?.(o)
        }}
      />
    </div>
  )
}

function QuickActionCurrencyField({
  label,
  value,
  onChange,
  disabled,
  currencyCode = 'USD',
  decimalPlaces,
  placeholder = '0.00',
}: {
  label: string
  value: number | undefined
  onChange: (value: unknown) => void
  disabled?: boolean
  currencyCode?: string
  decimalPlaces?: number
  placeholder?: string
}) {
  const shouldUpdateRef = useRef(false)

  const handleValueChange = useCallback(
    (next: number | undefined) => {
      if (shouldUpdateRef.current) {
        shouldUpdateRef.current = false
        onChange(next)
      }
    },
    [onChange]
  )

  const handleBlur = useCallback(() => {
    shouldUpdateRef.current = true
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }, [])

  return (
    <div className='flex items-center gap-2'>
      <label className='min-w-16 shrink-0 text-xs text-muted-foreground'>{label}</label>
      <CurrencyInputUi
        value={value}
        onValueChange={handleValueChange}
        currencyCode={currencyCode}
        decimals={decimalPlaces}
        disabled={disabled}>
        <InputGroup className='h-6 text-xs'>
          <CurrencyInputField
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className='text-xs'
          />
        </InputGroup>
      </CurrencyInputUi>
    </div>
  )
}
