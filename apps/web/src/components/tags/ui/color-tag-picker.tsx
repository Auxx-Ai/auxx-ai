// apps/web/src/components/tags/ui/color-tag-picker.tsx
'use client'

import {
  DEFAULT_SELECT_OPTION_COLOR,
  OPTION_COLORS,
  type SelectOptionColor,
} from '@auxx/lib/custom-fields/client'
import { cn } from '@auxx/ui/lib/utils'
import { Check } from 'lucide-react'

/** Props for ColorTagPicker component */
interface ColorPickerProps {
  value: SelectOptionColor
  onChange: (value: SelectOptionColor) => void
  disabled?: boolean
}

/** ColorTagPicker component for selecting from predefined named colors */
function ColorTagPicker({ onChange, value, disabled = false }: ColorPickerProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2',
        disabled && 'opacity-60 pointer-events-none'
      )}>
      {OPTION_COLORS.map((color) => {
        const isSelected = value === color.id
        return (
          <button
            key={color.id}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full transition-all hover:scale-110',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              color.swatch,
              // Keyboard focus reads as muted so it never competes with the blue
              // selection ring; on the selected swatch the selection ring stands.
              !isSelected && 'focus-visible:ring-muted-foreground/50',
              isSelected && 'ring-2 ring-blue-500 ring-offset-2 ring-offset-background'
            )}
            onClick={() => onChange(color.id)}
            type='button'
            disabled={disabled}
            aria-label={`Select ${color.label}`}>
            {isSelected && <Check className='size-4 text-white' />}
          </button>
        )
      })}
    </div>
  )
}

/** Form-connected version for use with react-hook-form */
export function FormColorTagPicker({
  value = DEFAULT_SELECT_OPTION_COLOR,
  onChange,
  onBlur,
  disabled = false,
  ...props
}: Omit<ColorPickerProps, 'value' | 'onChange'> & {
  value?: SelectOptionColor
  onChange?: (value: SelectOptionColor) => void
  onBlur?: () => void
  disabled?: boolean
}) {
  const handleChange = (color: SelectOptionColor) => {
    onChange?.(color)
  }

  return <ColorTagPicker value={value} onChange={handleChange} disabled={disabled} {...props} />
}

export { ColorTagPicker }
