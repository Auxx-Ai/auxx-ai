// apps/web/src/components/fields/inputs/name-input-field.tsx

import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFieldNavigationOptional } from '../field-navigation-context'
import { usePropertyContext } from '../property-provider'

/**
 * NameInputField
 * Editor for compound firstName + lastName field
 *
 * Pattern E: Save-on-close + keyboard navigation between inputs
 * - Local state for editing
 * - Uses onBeforeClose hook for fire-and-forget save
 * - Captures arrow keys to navigate between firstName/lastName
 * - Enter/ArrowDown in firstName → focus lastName
 * - Enter/ArrowDown in lastName → commit and close
 * - ArrowUp in lastName → focus firstName
 * - ArrowUp in firstName → commit, close, navigate to previous row
 */
export interface NameStruct {
  firstName: string
  lastName: string
}

/**
 * Shallow compare two NameStruct objects
 */
function hasNameChanged(a: NameStruct, b: NameStruct): boolean {
  return a.firstName !== b.firstName || a.lastName !== b.lastName
}

export function NameInputField() {
  const { value, commitValue, commitValueAndClose, onBeforeClose, isSaving } = usePropertyContext()
  const nav = useFieldNavigationOptional()

  const containerRef = useRef<HTMLDivElement>(null)

  // Capture arrow keys so FieldInput doesn't navigate rows
  useEffect(() => {
    nav?.setPopoverCapturing(true)
    return () => nav?.setPopoverCapturing(false)
  }, [nav])

  // Parse initial value
  const initial = (typeof value === 'object' && value !== null ? value : {}) as Partial<NameStruct>
  const initialName: NameStruct = {
    firstName: initial.firstName ?? '',
    lastName: initial.lastName ?? '',
  }

  const [fields, setFields] = useState<NameStruct>(initialName)

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

  /** Commit current fields and close, then navigate row */
  const commitCloseAndNavigate = useCallback(
    (direction: 'up' | 'down') => {
      if (hasNameChanged(fieldsRef.current, initialName)) {
        commitValueAndClose(fieldsRef.current)
      } else {
        commitValueAndClose(undefined)
      }
      nav?.moveFocus(direction)
    },
    [commitValueAndClose, initialName, nav]
  )

  const handleFirstNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        containerRef.current?.querySelector<HTMLInputElement>('#lastName')?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        commitCloseAndNavigate('up')
      }
    },
    [commitCloseAndNavigate]
  )

  const handleLastNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        commitCloseAndNavigate('down')
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        containerRef.current?.querySelector<HTMLInputElement>('#firstName')?.focus()
      }
    },
    [commitCloseAndNavigate]
  )

  return (
    <div ref={containerRef} className='p-3 pt-2 space-y-3'>
      <div className='space-y-2'>
        <Label htmlFor='firstName' className='text-sm font-medium'>
          First Name
        </Label>
        <Input
          id='firstName'
          autoComplete='one-time-code'
          size='sm'
          value={fields.firstName}
          onChange={(e) => setFields((f) => ({ ...f, firstName: e.target.value }))}
          onKeyDown={handleFirstNameKeyDown}
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
          autoComplete='one-time-code'
          size='sm'
          value={fields.lastName}
          onChange={(e) => setFields((f) => ({ ...f, lastName: e.target.value }))}
          onKeyDown={handleLastNameKeyDown}
          disabled={isSaving}
          placeholder='Enter last name'
          className='w-full'
        />
      </div>
    </div>
  )
}
