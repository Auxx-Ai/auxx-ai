// apps/web/src/components/contacts/input/multi-select-input-field.tsx
import { usePropertyContext } from '../drawer/property-provider'
import { useFieldNavigationOptional } from '../drawer/field-navigation-context'
import { useState, useEffect } from 'react'
import { ComboPicker, type Option } from '~/components/pickers/combo-picker'

/**
 * MultiSelectInputField
 * Editor for multi select field type using ComboPicker
 *
 * Pattern C: Selection picker
 * - commitValue fires immediately on each selection (fire-and-forget)
 * - Stays open for multiple selections
 * - CAPTURES arrow keys for option navigation
 */
export function MultiSelectInputField() {
  const { value, field, commitValue, isSaving } = usePropertyContext()
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

  // Initialize selected values from current value
  const [selected, setSelected] = useState<Option[]>(
    Array.isArray(value)
      ? options.filter((opt) => value.includes(opt.value))
      : typeof value === 'string' && value
        ? options.filter((opt) => value.split(',').includes(opt.value))
        : []
  )

  const [open, setOpen] = useState(true)

  /**
   * Handle selection changes - fire-and-forget save
   */
  const handleChange = (opts: Option[] | Option | null) => {
    if (Array.isArray(opts)) {
      setSelected(opts)
      // Fire-and-forget save
      const newValues = opts.map((opt) => opt.value)
      commitValue(newValues)
    }
  }

  return (
    <ComboPicker
      options={options}
      selected={selected}
      onChange={handleChange}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => {
        setOpen(false)
      }}
      multi={true}
      showSearch={true}
      searchPlaceholder="Search options..."
      popover={false}
      disabled={isSaving}
      className="w-full">
      <span>&nbsp;</span>
    </ComboPicker>
  )
}
