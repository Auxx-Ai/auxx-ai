// apps/web/src/components/contacts/input/single-select-input-field.tsx
import { usePropertyContext } from '../drawer/property-provider'
import { useFieldNavigationOptional } from '../drawer/field-navigation-context'
import { useState, useEffect } from 'react'
import { ComboPicker, type Option } from '~/components/pickers/combo-picker'

/**
 * SingleSelectInputField
 * Editor for single select field type using ComboPicker
 *
 * Pattern C: Selection picker
 * - commitValue fires immediately on selection (fire-and-forget)
 * - close() called after selection
 * - CAPTURES arrow keys for option navigation
 */
export function SingleSelectInputField() {
  const { value, field, commitValue, close, isSaving } = usePropertyContext()
  const nav = useFieldNavigationOptional()

  // Capture keys while open
  useEffect(() => {
    nav?.setPopoverCapturing(true)
    return () => nav?.setPopoverCapturing(false)
  }, [nav])

  // Convert field options to ComboPicker Option format
  const options: Option[] = (field?.options?.options || []).map((opt: any) => ({
    value: String(opt.value),
    label: String(opt.label),
  }))

  // Find the initially selected option
  const initialOption = options.find((opt) => opt.value === String(value)) || null
  const [selected, setSelected] = useState<Option | null>(initialOption)
  const [open, setOpen] = useState(true)

  /**
   * Handle selection change - fire-and-forget save, then close
   */
  const handleChange = (newSelected: Option | Option[] | null) => {
    if (!Array.isArray(newSelected)) {
      setSelected(newSelected)
      if (newSelected) {
        commitValue(newSelected.value)
      } else {
        commitValue('')
      }
      close()
    }
  }

  return (
    <ComboPicker
      options={options}
      selected={selected}
      onChange={handleChange}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      multi={false}
      showSearch={true}
      searchPlaceholder="Search options..."
      popover={false}
      disabled={isSaving}
      className="w-full">
      <span>&nbsp;</span>
    </ComboPicker>
  )
}
