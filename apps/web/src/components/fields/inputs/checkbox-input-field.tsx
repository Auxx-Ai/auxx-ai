// apps/web/src/components/fields/inputs/checkbox-input-field.tsx
import { Check, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePropertyContext } from '../property-provider'

/**
 * CheckboxInputField
 * Editor for checkbox field type
 *
 * Pattern B: Immediate save
 * - commitValue fires immediately on toggle (fire-and-forget)
 * - No local state needed for the toggle itself
 * - Does NOT capture arrow keys (allows row navigation)
 */
export function CheckboxInputField() {
  const { value, commitValue, isSaving } = usePropertyContext()
  const [checked, setChecked] = useState(!!value)

  // Sync local state when value changes externally
  useEffect(() => {
    setChecked(!!value)
  }, [value])

  /**
   * Handle toggle - fire-and-forget save
   */
  const handleToggle = () => {
    if (isSaving) return
    const newValue = !checked
    setChecked(newValue)
    commitValue(newValue)
  }

  const text = checked ? 'True' : 'False'
  const Icon = isSaving ? Loader2 : checked ? Check : X

  return (
    <div
      className={`flex items-center h-6.5 justify-center gap-2 text-sm px-2 bg-natural-300 dark:bg-natural-800 rounded-full ${isSaving ? 'opacity-70' : 'cursor-pointer'}`}
      onClick={handleToggle}>
      <Icon className={`size-4 ${isSaving ? 'animate-spin' : ''}`} />
      <span className='text-muted-foreground'>{text}</span>
    </div>
  )
}
