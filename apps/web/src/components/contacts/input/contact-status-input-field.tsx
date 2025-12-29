import { usePropertyContext } from '../drawer/property-provider'
import { useRef, useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'

/**
 * ContactStatusInputField
 * Editor for contact status field
 */
export function ContactStatusInputField() {
  const { value, setValue, onChange, isSaving, save } = usePropertyContext()
  const [selectValue, setSelectValue] = useState(value ?? 'ACTIVE')

  useEffect(() => {
    setSelectValue(value ?? 'ACTIVE')
  }, [value])

  const handleValueChange = (newValue: string) => {
    setSelectValue(newValue)
    onChange(newValue)
    // Auto-save for select fields
    setValue(newValue)
  }

  const statusOptions = [
    { value: 'ACTIVE', label: 'Active' },
    { value: 'INACTIVE', label: 'Inactive' },
    { value: 'SPAM', label: 'Spam' },
    { value: 'MERGED', label: 'Merged' },
  ]

  return (
    <div className="p-2">
      <Select value={selectValue} onValueChange={handleValueChange} disabled={isSaving}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select status" />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
