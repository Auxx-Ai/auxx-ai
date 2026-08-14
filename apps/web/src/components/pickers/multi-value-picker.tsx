// apps/web/src/components/pickers/multi-value-picker.tsx
'use client'

import {
  type FieldOptions,
  formatToDisplayValue,
  MAX_MULTI_VALUES,
} from '@auxx/lib/field-values/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandDetailItem,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { formatUrlForDisplay, normalizeUrl } from '@auxx/utils'
import { ArrowUpToLine, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Props for the MultiValuePicker component
 */
export interface MultiValuePickerProps {
  /** Field type driving validation + display formatting: EMAIL, URL or PHONE_INTL */
  fieldType: string

  /** Current value list — primary first (index 0) */
  values: string[]

  /** Called with the full re-ordered/edited array on every change */
  onChange: (values: string[]) => void

  /** Field options (phoneFormat, …) for display formatting */
  fieldOptions?: FieldOptions

  /** Placeholder text for the combined filter/entry input */
  placeholder?: string

  /** Disabled state */
  disabled?: boolean

  /** Callback when arrow key capture state changes (for parent navigation) */
  onCaptureChange?: (capturing: boolean) => void

  /** Additional className for Command wrapper */
  className?: string
}

/** Client-side per-type validation gate for the Create row. Server still normalizes. */
export function isValidMultiValue(fieldType: string, raw: string): boolean {
  const value = raw.trim()
  if (!value) return false
  switch (fieldType) {
    case 'EMAIL':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    case 'URL': {
      try {
        const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`
        const parsed = new URL(candidate)
        return parsed.hostname.includes('.')
      } catch {
        return false
      }
    }
    case 'PHONE_INTL':
      return /^[+]?[1-9][\d\s\-().]{7,15}$/.test(value.replace(/\s/g, ''))
    default:
      return true
  }
}

/** Display-format one value for its row title (raw value stays the stored one). */
function formatValueForDisplay(
  fieldType: string,
  value: string,
  fieldOptions?: FieldOptions
): string {
  if (fieldType === 'PHONE_INTL') {
    return (
      (formatToDisplayValue({ type: 'text', value }, 'PHONE_INTL', fieldOptions) as string) || value
    )
  }
  if (fieldType === 'URL') {
    const normalized = normalizeUrl(value)
    return normalized ? formatUrlForDisplay(normalized) : value
  }
  return value
}

/** Normalize a typed value before storing — email lowercases (matches the server hooks). */
function normalizeNewValue(fieldType: string, raw: string): string {
  const value = raw.trim()
  return fieldType === 'EMAIL' ? value.toLowerCase() : value
}

/**
 * MultiValuePicker
 * Tags-style value-list editor for multi-value scalar fields (options.multi
 * EMAIL/URL/PHONE). The `CommandInput` doubles as filter and entry field; a
 * `Create "«typed»"` row appears for valid, non-duplicate input while under
 * the value cap. Value rows are `CommandDetailItem`s with `selectionMode='none'`
 * — a bare row click is deliberately a no-op (it must never silently retarget
 * outbound mail); explicit hover actions handle set-as-primary and remove.
 */
export function MultiValuePicker({
  fieldType,
  values,
  onChange,
  fieldOptions,
  placeholder = 'Search or add...',
  disabled = false,
  onCaptureChange,
  className,
}: MultiValuePickerProps) {
  // Notify parent about capture state on mount/unmount
  useEffect(() => {
    onCaptureChange?.(true)
    return () => onCaptureChange?.(false)
  }, [onCaptureChange])

  const [searchValue, setSearchValue] = useState('')

  // Filter values by search (raw + display-formatted, case-insensitive)
  const filteredValues = useMemo(() => {
    if (!searchValue.trim()) return values
    const search = searchValue.toLowerCase()
    return values.filter(
      (v) =>
        v.toLowerCase().includes(search) ||
        formatValueForDisplay(fieldType, v, fieldOptions).toLowerCase().includes(search)
    )
  }, [values, searchValue, fieldType, fieldOptions])

  // Hide the Create row when the typed value already exists (case-insensitive)
  const searchMatchesExisting = useMemo(() => {
    const typed = normalizeNewValue(fieldType, searchValue).toLowerCase()
    if (!typed) return true
    return values.some((v) => v.toLowerCase() === typed)
  }, [values, searchValue, fieldType])

  const typedIsValid = useMemo(
    () => isValidMultiValue(fieldType, searchValue),
    [fieldType, searchValue]
  )

  const atCap = values.length >= MAX_MULTI_VALUES
  const showCreate =
    !disabled && searchValue.trim() !== '' && typedIsValid && !searchMatchesExisting && !atCap

  /** Append the typed value at the end of the list. */
  const createValue = useCallback(() => {
    const newValue = normalizeNewValue(fieldType, searchValue)
    if (!newValue || !isValidMultiValue(fieldType, newValue)) return
    if (values.some((v) => v.toLowerCase() === newValue.toLowerCase())) {
      setSearchValue('')
      return
    }
    if (values.length >= MAX_MULTI_VALUES) return
    onChange([...values, newValue])
    setSearchValue('')
  }, [fieldType, searchValue, values, onChange])

  /** Move a value to the front — index 0 IS the primary. */
  const setPrimary = useCallback(
    (value: string) => {
      const index = values.indexOf(value)
      if (index <= 0) return
      onChange([value, ...values.filter((_, i) => i !== index)])
    },
    [values, onChange]
  )

  /** Remove a value from the list. */
  const removeValue = useCallback(
    (value: string) => {
      onChange(values.filter((v) => v !== value))
    },
    [values, onChange]
  )

  return (
    <Command shouldFilter={false} className={cn('rounded-lg', className)}>
      <CommandInput
        placeholder={placeholder}
        value={searchValue}
        onValueChange={setSearchValue}
        disabled={disabled}
      />

      <CommandList>
        {/* Create row — inside the list, beside the results it filters. Hidden
            at the value cap and for invalid/duplicate input. */}
        {showCreate && (
          <>
            <CommandGroup>
              <CommandItem
                onSelect={createValue}
                className='cursor-pointer h-7'
                disabled={disabled}>
                <Plus className='text-muted-foreground' />
                <span>
                  Add "<span className='font-medium'>{searchValue.trim()}</span>"
                </span>
              </CommandItem>
            </CommandGroup>
            <div className='-mx-1 h-px bg-border/50' />
          </>
        )}

        {filteredValues.length === 0 && !searchValue.trim() && (
          <CommandEmpty>No values yet. Type to add one.</CommandEmpty>
        )}

        {filteredValues.length > 0 && (
          <CommandGroup>
            {filteredValues.map((value) => {
              const index = values.indexOf(value)
              const isPrimary = index === 0
              return (
                <CommandDetailItem
                  key={value}
                  value={value}
                  title={formatValueForDisplay(fieldType, value, fieldOptions)}
                  secondary={
                    isPrimary ? (
                      <Badge variant='secondary' className='shrink-0'>
                        Primary
                      </Badge>
                    ) : undefined
                  }
                  selectionMode='none'
                  // A bare click must never retarget outbound mail — actions
                  // are explicit hover buttons only.
                  onSelect={() => {}}
                  disabled={disabled}
                  actions={
                    <>
                      {!isPrimary && (
                        <Button
                          variant='ghost'
                          size='icon-xs'
                          title='Set as primary'
                          disabled={disabled}
                          onClick={(e) => {
                            e.stopPropagation()
                            setPrimary(value)
                          }}>
                          <ArrowUpToLine />
                        </Button>
                      )}
                      <Button
                        variant='destructive-hover'
                        size='icon-xs'
                        title='Remove'
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeValue(value)
                        }}>
                        <Trash2 />
                      </Button>
                    </>
                  }
                />
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
