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
}

/** ColorTagPicker component for selecting from predefined named colors */
function ColorTagPicker({ onChange, value }: ColorPickerProps) {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      {OPTION_COLORS.map((color) => {
        const isSelected = value === color.id
        return (
          <button
            key={color.id}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full transition-all hover:scale-110 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
              color.swatch,
              isSelected && 'ring-2 ring-blue-500 ring-offset-2'
            )}
            onClick={() => onChange(color.id)}
            type='button'
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
  ...props
}: Omit<ColorPickerProps, 'value' | 'onChange'> & {
  value?: SelectOptionColor
  onChange?: (value: SelectOptionColor) => void
  onBlur?: () => void
}) {
  const handleChange = (color: SelectOptionColor) => {
    onChange?.(color)
  }

  return <ColorTagPicker value={value} onChange={handleChange} {...props} />
}

export { ColorTagPicker }
