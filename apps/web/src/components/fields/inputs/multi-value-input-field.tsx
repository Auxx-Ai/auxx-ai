// apps/web/src/components/fields/inputs/multi-value-input-field.tsx
'use client'

import type { FieldOptions } from '@auxx/lib/field-values/client'
import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatValueForDisplay, MultiValuePicker } from '~/components/pickers/multi-value-picker'
import { ItemsListView } from '~/components/ui/items-list-view'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { useFieldNavigationOptional } from '../field-navigation-context'
import { usePropertyContext } from '../property-provider'
import { useOrgBusinessCountry } from './use-org-business-country'

/** Placeholder per field type for the picker's entry input. */
function placeholderFor(fieldType: string): string {
  switch (fieldType) {
    case 'EMAIL':
      return 'Search or add email...'
    case 'URL':
      return 'Search or add website...'
    case 'PHONE_INTL':
      // The phone arm is a real phone input, not a search box.
      return 'Enter phone number'
    default:
      return 'Search or add...'
  }
}

/** Normalize whatever the store/context holds into a string list. */
function toValueList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v !== '')
  }
  if (typeof value === 'string' && value !== '') return [value]
  return []
}

/**
 * MultiValueInputField
 * Panel/popover editor for multi-value scalar fields (options.multi
 * EMAIL/URL/PHONE). Mirrors `SelectInputField`'s save idiom: every picker
 * change is a whole-array `set`, debounced, with an `onBeforeClose` flush so
 * dismissing the popover commits the pending state.
 */
export function MultiValueInputField() {
  const { value, field, commitValue, onBeforeClose } = usePropertyContext()
  const nav = useFieldNavigationOptional()
  const defaultCountry = useOrgBusinessCountry()
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const fieldType: string = field?.fieldType || field?.type

  const [localValues, setLocalValues] = useState<string[]>(() => toValueList(value))

  // Ref to track current local value (for the onBeforeClose handler)
  const localValuesRef = useRef<string[]>(localValues)
  useEffect(() => {
    localValuesRef.current = localValues
  }, [localValues])

  // Adopt the server's shape of the list. The provider re-derives `value` from
  // the store on every confirmed write (`property-provider.tsx` syncs on
  // `storeValue`), so this is what brings the WRITE-NORMALIZED form back into an
  // open popover — E.164 for phone, lowercased for email — and what visibly
  // drops a value the server rejected and rolled back.
  //
  // Keyed on the CONTENT, not on `value`'s identity: the provider derives it
  // through `formatToRawValue`, which mints a fresh array, and an identity dep
  // would eat in-flight edits the day that moves into render.
  const serverKey = JSON.stringify(toValueList(value))
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on serverKey by design — see above
  useEffect(() => {
    setLocalValues(toValueList(value))
  }, [serverKey])

  /** Debounced whole-array save — waits for the user to stop editing. */
  const debouncedSave = useCallback(
    (newValues: string[]) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      saveTimeoutRef.current = setTimeout(() => {
        // Null the ref as the timer fires. Without this it holds a DEAD id
        // forever, which makes `onBeforeClose` issue a redundant second commit
        // and would silently disable any future "is a save pending?" guard.
        saveTimeoutRef.current = null
        commitValue(newValues)
      }, 300)
    },
    [commitValue]
  )

  // Flush the pending debounced save when the popover closes
  useEffect(() => {
    onBeforeClose.current = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
        commitValue(localValuesRef.current)
      }
    }
    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, commitValue])

  // Cleanup timeout on unmount (onBeforeClose already handled the save if needed)
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const handleChange = useCallback(
    (newValues: string[]) => {
      setLocalValues(newValues)
      debouncedSave(newValues)
    },
    [debouncedSave]
  )

  const handleCaptureChange = useCallback(
    (capturing: boolean) => {
      nav?.setPopoverCapturing(capturing)
    },
    [nav]
  )

  return (
    <MultiValuePicker
      fieldType={fieldType}
      values={localValues}
      onChange={handleChange}
      fieldOptions={field?.options as FieldOptions | undefined}
      placeholder={placeholderFor(fieldType)}
      onCaptureChange={handleCaptureChange}
      defaultCountry={defaultCountry}
    />
  )
}

// ─────────────────────────────────────────────────────────────────
// MultiValueFieldInput - Standalone input (used by FieldInputAdapter)
// ─────────────────────────────────────────────────────────────────

/**
 * Props for MultiValueFieldInput (standalone usage — create dialog, forms)
 */
export interface MultiValueFieldInputProps {
  /** Field type: EMAIL, URL or PHONE_INTL */
  fieldType: string
  /** Current values — primary first. Callers may pass a scalar; it is wrapped. */
  value: unknown
  /** Change handler — always receives the full string[] */
  onChange: (values: string[]) => void
  /** Field options (multi flag, phoneFormat, …) */
  fieldOptions?: FieldOptions
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className */
  className?: string
  /** Trigger customization options */
  triggerProps?: PickerTriggerOptions
  /** Controlled open state */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
  /** Callback to check if a dismiss event should be prevented. Return true to prevent closing. */
  shouldPreventDismiss?: (target: HTMLElement) => boolean
}

/**
 * MultiValueFieldInput
 * Standalone popover input for multi-value scalar fields — a `PickerTrigger`
 * showing the current values as chips, opening a `MultiValuePicker`. Form
 * state is caller-owned (`value`/`onChange`), so writes land as whole arrays
 * (the create dialog path).
 */
export function MultiValueFieldInput({
  fieldType,
  value,
  onChange,
  fieldOptions,
  placeholder,
  disabled = false,
  className,
  triggerProps,
  open: controlledOpen,
  onOpenChange,
  shouldPreventDismiss,
}: MultiValueFieldInputProps) {
  const values = toValueList(value)
  const defaultCountry = useOrgBusinessCountry()

  // Chips render display-formatted, matching `DisplayPhone` and the table cell.
  // Raw text here meant a stored `+15102055536` ignored the field's own
  // `phoneFormat` and read as an unformatted E.164 blob.
  const chips = useMemo(
    () =>
      values.map((v, index) => ({
        id: `${index}:${v}`,
        value: formatValueForDisplay(fieldType, v, fieldOptions),
      })),
    [values, fieldType, fieldOptions]
  )

  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (newOpen: boolean) => {
    if (controlledOpen === undefined) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen)
  }

  const handleClearAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onChange([])
    },
    [onChange]
  )

  const hasValue = values.length > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          disabled={disabled}
          variant={triggerProps?.variant ?? 'transparent'}
          hasValue={hasValue}
          placeholder={placeholder ?? placeholderFor(fieldType)}
          showClear={triggerProps?.showClear ?? true}
          onClear={handleClearAll}
          asCombobox
          className={cn(className, triggerProps?.className)}>
          <ItemsListView
            items={chips}
            renderItem={(item) => (
              <Badge variant='pill' className='shrink-0'>
                {typeof item === 'object' ? (item.value as string) : String(item)}
              </Badge>
            )}
            maxDisplay={3}
            className='flex-1'
          />
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent
        className='min-w-[var(--radix-popover-trigger-width)] p-0'
        align='start'
        onPointerDownOutside={(e) => {
          if (shouldPreventDismiss?.(e.target as HTMLElement)) e.preventDefault()
        }}
        onFocusOutside={(e) => {
          if (shouldPreventDismiss?.(e.target as HTMLElement)) e.preventDefault()
        }}>
        <MultiValuePicker
          fieldType={fieldType}
          values={values}
          onChange={onChange}
          fieldOptions={fieldOptions}
          placeholder={placeholder ?? placeholderFor(fieldType)}
          disabled={disabled}
          defaultCountry={defaultCountry}
        />
      </PopoverContent>
    </Popover>
  )
}
