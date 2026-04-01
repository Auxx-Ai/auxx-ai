// apps/web/src/components/mail/email-editor/quick-action-panel.tsx

'use client'

import type { DraftActionPayload } from '@auxx/lib/quick-actions/client'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight, Plus, X, Zap } from 'lucide-react'
import { useState } from 'react'
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
}

export function QuickActionPanel({ actions, onRemove, onUpdate, disabled }: QuickActionPanelProps) {
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
}: {
  action: DraftActionPayload
  onRemove: () => void
  onUpdate: (actionId: string, inputs: Record<string, unknown>) => void
  disabled?: boolean
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
        />
      )}
    </div>
  )
}

interface AddActionButtonProps {
  threadId?: string
  ticketId?: string
  onSelect: (action: DraftActionPayload) => void
  disabled?: boolean
  popoverClassName?: string
  onOpenChange?: (open: boolean) => void
}

export function AddActionButton({
  threadId,
  ticketId,
  onSelect,
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
          className='h-6 gap-1 text-xs text-muted-foreground'>
          <Zap className='size-3' />
          <Plus className='size-3' />
          Add action
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className={cn('w-64 p-2', popoverClassName)}>
        <QuickActionPicker
          threadId={threadId}
          ticketId={ticketId}
          onSelect={(action) => {
            onSelect(action)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function QuickActionPicker({
  onSelect,
  threadId,
  ticketId,
}: {
  onSelect: (action: DraftActionPayload) => void
  threadId?: string
  ticketId?: string
}) {
  const { actions, isLoading } = useQuickActions(threadId, ticketId)

  if (isLoading) {
    return <div className='py-4 text-center text-xs text-muted-foreground'>Loading...</div>
  }

  if (actions.length === 0) {
    return (
      <div className='py-4 text-center text-xs text-muted-foreground'>
        No quick actions available.
        <br />
        Install apps with quick actions to get started.
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-1 p-1'>
      {actions.map((action) => (
        <button
          key={`${action.appId}:${action.id}`}
          type='button'
          className='flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent'
          onClick={() => {
            // Cache schema for form rendering
            cacheActionSchema(action)

            onSelect({
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
          }}>
          {action.color && (
            <span
              className='size-2 shrink-0 rounded-full'
              style={{ backgroundColor: action.color }}
            />
          )}
          <div className='min-w-0'>
            <div className='truncate font-medium'>{action.label}</div>
            {action.description && (
              <div className='truncate text-xs text-muted-foreground'>{action.description}</div>
            )}
          </div>
        </button>
      ))}
    </div>
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
}: {
  fields: Record<string, any>
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  disabled?: boolean
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
}: {
  fieldKey: string
  field: any
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
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
    case 'currency':
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
          <Select
            value={(value as string) ?? ''}
            onValueChange={(v) => onChange(v)}
            disabled={disabled}>
            <SelectTrigger className='h-6 text-xs'>
              <SelectValue placeholder={field.placeholder || 'Select...'} />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((opt: any) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label || opt.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
