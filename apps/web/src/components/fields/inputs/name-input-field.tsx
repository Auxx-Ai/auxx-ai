// apps/web/src/components/fields/inputs/name-input-field.tsx

import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { useEffect, useRef, useState } from 'react'
import { usePropertyContext } from '../property-provider'

/**
 * NameInputField
 * Editor for compound firstName + lastName field
 *
 * Pattern E: Save-on-close
 * - Local state for editing
 * - Uses onBeforeClose hook for fire-and-forget save
 * - Does NOT capture arrow keys (allows row navigation)
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
  const { value, commitValue, onBeforeClose, isSaving } = usePropertyContext()

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
