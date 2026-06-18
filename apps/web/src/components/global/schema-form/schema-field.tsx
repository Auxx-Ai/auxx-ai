// apps/web/src/components/global/schema-form/schema-field.tsx

'use client'

import { Checkbox } from '@auxx/ui/components/checkbox'
import { Input } from '@auxx/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import type { FieldEntry } from './types'

interface SchemaFieldProps {
  entry: FieldEntry
  value: unknown
  onChange: (next: unknown) => void
}

/**
 * Renders a single declared schema field (select / multiselect / boolean /
 * number / text) with label, description, required marker and default. Driven
 * by the `_metadata`-annotated node shape the app catalog emits — shared by the
 * agent trigger inputs form and the connector `config` form.
 */
export function SchemaField({ entry, value, onChange }: SchemaFieldProps) {
  const { key, node, meta, required } = entry
  const inputId = `schema-input-${key}`
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
