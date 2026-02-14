// apps/web/src/components/fields/inputs/name-field-input.tsx
'use client'

import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { usePropertyContext } from '../property-provider'

/**
 * Value structure for NAME fields
 */
export interface NameValue {
  firstName: string
  lastName: string
}

/**
 * Shallow compare two NameValue objects
 */
function hasNameChanged(a: NameValue, b: NameValue): boolean {
  return a.firstName !== b.firstName || a.lastName !== b.lastName
}

/**
 * Format name for display in trigger
 */
function formatDisplayName(value: NameValue | null | undefined): string {
  if (!value) return ''
  const parts = [value.firstName, value.lastName].filter(Boolean)
  return parts.join(' ')
}

// ─────────────────────────────────────────────────────────────────
// NameInputField - PropertyProvider-based input (used by PropertyPanel)
// ─────────────────────────────────────────────────────────────────

/**
 * NameInputField
 * Editor for compound firstName + lastName field
 *
 * Pattern E: Save-on-close
 * - Local state for editing
 * - Uses onBeforeClose hook for fire-and-forget save
 * - Does NOT capture arrow keys (allows row navigation)
 */
export function NameInputField() {
  const { value, commitValue, onBeforeClose, isSaving } = usePropertyContext()

  // Parse initial value
  const initial = (typeof value === 'object' && value !== null ? value : {}) as Partial<NameValue>
  const initialName: NameValue = {
    firstName: initial.firstName ?? '',
    lastName: initial.lastName ?? '',
  }

  const [fields, setFields] = useState<NameValue>(initialName)

  // Keep ref in sync for save-on-close
  const fieldsRef = useRef(fields)
  useEffect(() => {
    fieldsRef.current = fields
  }, [fields])

  // Register save handler for popover close - fire-and-forget
  // biome-ignore lint/correctness/useExhaustiveDependencies: using initialName sub-properties for granular dependency tracking
  useEffect(() => {
    onBeforeClose.current = () => {
      if (hasNameChanged(fieldsRef.current, initialName)) {
        commitValue(fieldsRef.current)
      }
    }
    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, initialName.firstName, initialName.lastName, commitValue])

  return (
    <div className='p-3 pt-2 space-y-3'>
      <div className='space-y-2'>
        <Label htmlFor='firstName' className='text-sm font-medium'>
          First Name
        </Label>
        <Input
          id='firstName'
          size='sm'
          value={fields.firstName}
          onChange={(e) => setFields((f) => ({ ...f, firstName: e.target.value }))}
          disabled={isSaving}
          placeholder='Enter first name'
          className='w-full'
          autoFocus
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='lastName' className='text-sm font-medium'>
          Last Name
        </Label>
        <Input
          id='lastName'
          size='sm'
          value={fields.lastName}
          onChange={(e) => setFields((f) => ({ ...f, lastName: e.target.value }))}
          disabled={isSaving}
          placeholder='Enter last name'
          className='w-full'
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// NameFieldInput - Standalone input (used by FieldInputAdapter)
// ─────────────────────────────────────────────────────────────────

/**
 * Props for NameFieldInput (standalone usage)
 */
export interface NameFieldInputProps {
  /** Current value */
  value: NameValue | null | undefined
  /** Change handler */
  onChange: (value: NameValue) => void
  /** Placeholder text for trigger */
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
}

/**
 * NameFieldInput
 * Standalone input for NAME fields.
 * Uses PickerTrigger for display, Popover with two inputs for editing.
 */
export function NameFieldInput({
  value,
  onChange,
  placeholder = 'Enter name...',
  disabled = false,
  className,
  triggerProps,
  open: controlledOpen,
  onOpenChange,
}: NameFieldInputProps) {
  const [internalOpen, setInternalOpen] = useState(false)

  // Local state for inputs (to avoid calling onChange on every keystroke)
  const [localFirstName, setLocalFirstName] = useState(value?.firstName ?? '')
  const [localLastName, setLocalLastName] = useState(value?.lastName ?? '')

  // Ref for tracking if we need to commit on close
  const isDirty = useRef(false)

  // Use controlled or uncontrolled state
  const open = controlledOpen ?? internalOpen
  const setOpen = (newOpen: boolean) => {
    // Commit changes when closing
    if (!newOpen && isDirty.current) {
      onChange({ firstName: localFirstName, lastName: localLastName })
      isDirty.current = false
    }

    if (controlledOpen === undefined) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen)
  }

  // Sync local state when prop value changes (and popover is closed)
  useEffect(() => {
    if (!open) {
      setLocalFirstName(value?.firstName ?? '')
      setLocalLastName(value?.lastName ?? '')
    }
  }, [value?.firstName, value?.lastName, open])

  /**
   * Handle input changes - update local state and mark dirty
   */
  const handleFirstNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalFirstName(e.target.value)
    isDirty.current = true
  }, [])

  const handleLastNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalLastName(e.target.value)
    isDirty.current = true
  }, [])

  /**
   * Handle Enter key to commit and close
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: setOpen is a stable useState setter
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onChange({ firstName: localFirstName, lastName: localLastName })
        isDirty.current = false
        setOpen(false)
      }
    },
    [localFirstName, localLastName, onChange]
  )

  /**
   * Clear the name
   */
  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onChange({ firstName: '', lastName: '' })
      setLocalFirstName('')
      setLocalLastName('')
    },
    [onChange]
  )

  const displayName = formatDisplayName(value)
  const hasValue = !!displayName

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          disabled={disabled}
          variant={triggerProps?.variant ?? 'transparent'}
          size={triggerProps?.size}
          hasValue={hasValue}
          placeholder={placeholder}
          showClear={triggerProps?.showClear}
          onClear={handleClear}
          icon={triggerProps?.icon}
          iconPosition={triggerProps?.iconPosition}
          hideIcon={triggerProps?.hideIcon}
          className={cn(className, triggerProps?.className)}>
          <span className='truncate'>{displayName}</span>
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent className='w-[280px] p-3' align='start' onKeyDown={handleKeyDown}>
        <div className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='name-first' className='text-xs text-muted-foreground'>
              First Name
            </Label>
            <Input
              id='name-first'
              size='sm'
              value={localFirstName}
              onChange={handleFirstNameChange}
              disabled={disabled}
              placeholder='First name'
              autoFocus
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='name-last' className='text-xs text-muted-foreground'>
              Last Name
            </Label>
            <Input
              id='name-last'
              size='sm'
              value={localLastName}
              onChange={handleLastNameChange}
              disabled={disabled}
              placeholder='Last name'
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
