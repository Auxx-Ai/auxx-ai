// apps/web/src/components/fields/displays/display-checkbox.tsx
import { Check, X } from 'lucide-react'
import { usePropertyContext } from '../property-provider'
import DisplayWrapper from './display-wrapper'
import type { BooleanFieldOptions } from '@auxx/lib/field-values/client'

/**
 * DisplayCheckbox component
 * Renders a checkbox value with options from field.options (flat structure)
 * Note: We don't use the converter here because we need to render icons,
 * which the converter can't do (it returns strings only).
 */
export function DisplayCheckbox() {
  const { value, field } = usePropertyContext()
  // Read display options from field.options (flat structure)
  const opts = field.options as BooleanFieldOptions | undefined
  const checkboxStyle = opts?.checkboxStyle ?? 'icon-text'
  const trueLabel = opts?.trueLabel ?? 'True'
  const falseLabel = opts?.falseLabel ?? 'False'
  const label = value ? trueLabel : falseLabel

  // Text-only display
  if (checkboxStyle === 'text') {
    return (
      <DisplayWrapper copyValue={label}>
        <span className="text-muted-foreground">{label}</span>
      </DisplayWrapper>
    )
  }

  // Icon-only display
  if (checkboxStyle === 'icon') {
    return (
      <DisplayWrapper copyValue={label}>
        {value ? <Check className="size-4" /> : <X className="size-4" />}
      </DisplayWrapper>
    )
  }

  // Icon with text display (default)
  return (
    <DisplayWrapper copyValue={label}>
      <div className="flex items-center justify-center gap-2">
        {value ? <Check className="size-4" /> : <X className="size-4" />}
        <span className="text-muted-foreground">{label}</span>
      </div>
    </DisplayWrapper>
  )
}
