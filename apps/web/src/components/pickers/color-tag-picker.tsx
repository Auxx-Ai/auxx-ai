// apps/web/src/components/pickers/color-tag-picker.tsx

import React, { useState } from 'react'

/** Props for ColorTagPicker component */
interface ColorPickerProps {
  value: string
  onChange: (value: string) => void
}

/** ColorTagPicker component for selecting from predefined colors */
function ColorTagPicker({ onChange, value }: ColorPickerProps) {
  // Define 10 default colors
  const colors = [
    '#8D8D8D', // Gray
    '#D7A4D3', // Pink
    '#F2A99B', // Coral
    '#F5C8A3', // Peach
    '#F5E7A3', // Light Yellow
    '#B9E3B9', // Light Green
    '#A7D8E2', // Light Blue
    '#A7C1F2', // Blue
    '#C9B6F2', // Purple
    '#F5E1A4', // Light Gold
  ]

  // State to track the selected color (use value or the first color as default)
  const [selectedColor, setSelectedColor] = useState(value || colors[0])

  // Handle color selection
  const handleColorSelect = (color) => {
    setSelectedColor(color)
    if (onChange) {
      onChange(color)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {colors.map((color, index) => (
        <button
          key={index}
          className={`flex h-6 w-6 items-center justify-center rounded-full transition-all hover:scale-110 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${selectedColor === color ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}
          style={{ backgroundColor: color }}
          onClick={() => handleColorSelect(color)}
          type="button"
          aria-label={`Select color ${index + 1}`}>
          {selectedColor === color && (
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              stroke="currentColor"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={color === '#8D8D8D' ? 'text-white' : 'text-gray-800'}>
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          )}
        </button>
      ))}
    </div>
  )
}

// Form-connected version for use with react-hook-form
export function FormColorTagPicker({
  value = '#4f46e5',
  onChange,
  onBlur,
  ...props
}: Omit<ColorPickerProps, 'value' | 'onChange'> & {
  value?: string
  onChange?: (value: string) => void
  onBlur?: () => void
}) {
  const handleChange = (color: string) => {
    onChange?.(color)
  }

  return <ColorTagPicker value={value} onChange={handleChange} {...props} />
}

export { ColorTagPicker, FormColorTagPicker }
