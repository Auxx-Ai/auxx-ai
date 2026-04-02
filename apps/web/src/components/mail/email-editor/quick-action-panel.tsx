// apps/web/src/components/mail/email-editor/quick-action-panel.tsx

'use client'

import type { DraftActionPayload } from '@auxx/lib/quick-actions/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
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
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { useQuickActions } from '~/hooks/use-quick-actions'
import type { SerializedQuickAction } from '~/lib/workflow/workflow-block-loader'

// Schema cache for form rendering (populated when actions are loaded)
const quickActionSchemaCache = new Map<string, { inputs: Record<string, any> }>()

interface QuickActionPanelProps {
  actions: DraftActionPayload[]
  onAdd: (action: DraftActionPayload) => void
  onRemove: (actionId: string) => void
  onUpdate: (actionId: string, inputs: Record<string, unknown>) => void
  threadId?: string
  ticketId?: string
  disabled?: boolean
  popoverClassName?: string
  onPopoverOpenChange?: (open: boolean) => void
}

export function QuickActionPanel({
  actions,
  onRemove,
  onUpdate,
  disabled,
  popoverClassName,
  onPopoverOpenChange,
}: QuickActionPanelProps) {
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
  onRemove,
  onUpdate,
  disabled,
  popoverClassName,
  onPopoverOpenChange,
}: {
  action: DraftActionPayload
  onRemove: () => void
  onUpdate: (actionId: string, inputs: Record<string, unknown>) => void
  disabled?: boolean
  popoverClassName?: string
  onPopoverOpenChange?: (open: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const schema = quickActionSchemaCache.get(`${action.appId}:${action.actionId}`)

  return (
    <div className='flex flex-col'>
      <div
        className={cn(
          'group inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-xs',
          disabled && 'opacity-50',
          schema && !disabled && 'cursor-pointer'
        )}
        onClick={() => schema && !disabled && setExpanded(!expanded)}>
        {schema && (
          <span className='size-3 shrink-0 text-muted-foreground'>
            {expanded ? <ChevronDown className='size-3' /> : <ChevronRight className='size-3' />}
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

        {!disabled && (
          <button
            type='button'
            className='ml-0.5 opacity-0 transition-opacity group-hover:opacity-100'
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}>
            <X className='size-3' />
          </button>
        )}
      </div>

      {expanded && schema && (
        <QuickActionForm
          fields={schema.inputs}
          values={action.inputs}
          onChange={(inputs) => onUpdate(action.actionId, inputs)}
          disabled={disabled}
          popoverClassName={popoverClassName}
          onPopoverOpenChange={onPopoverOpenChange}
        />
      )}
    </div>
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
  const { actions, isLoading } = useQuickActions(threadId, ticketId)

  const options: SelectOption[] = useMemo(
    () => actions.map((a) => ({ value: a.id, label: a.label, color: a.color })),
    [actions]
  )

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
          cacheActionSchema(action)
          onAdd({
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
          })
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
      placeholder='Search actions...'
      canManage={false}
      canAdd={false}
      isLoading={isLoading}
    />
  )
}

/** Cache action schema for inline form rendering */
function cacheActionSchema(action: SerializedQuickAction) {
  const key = `${action.appId}:${action.id}`
  if (action.inputs && Object.keys(action.inputs).length > 0) {
    quickActionSchemaCache.set(key, { inputs: action.inputs })
  }
}

// ===== QuickActionForm =====

function QuickActionForm({
  fields,
  values,
  onChange,
  disabled,
  popoverClassName,
  onPopoverOpenChange,
}: {
  fields: Record<string, any>
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  disabled?: boolean
  popoverClassName?: string
  onPopoverOpenChange?: (open: boolean) => void
}) {
  const entries = Object.entries(fields)
  if (entries.length === 0) return null

  return (
    <div className='mt-1 flex flex-col gap-1.5 border-t pt-1.5'>
      {entries.map(([key, field]) => (
        <QuickActionField
          key={key}
          fieldKey={key}
          field={field}
          value={values[key]}
          onChange={(v) => onChange({ ...values, [key]: v })}
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
  disabled,
  popoverClassName,
  onPopoverOpenChange,
}: {
  fieldKey: string
  field: any
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  popoverClassName?: string
  onPopoverOpenChange?: (open: boolean) => void
}) {
  const label = field.label || fieldKey

  switch (field.type) {
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
    (cents: number | undefined) => {
      if (shouldUpdateRef.current) {
        shouldUpdateRef.current = false
        onChange(cents ?? undefined)
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
        decimalPlaces={decimalPlaces === 0 ? 'no-decimal' : 'two-places'}
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
