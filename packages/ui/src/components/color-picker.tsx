// components/ui/color-picker.tsx

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Check } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'

// Predefined color palette for organizational groups
const colorPalette = [
  // Blues
  '#0ea5e9',
  '#3b82f6',
  '#2563eb',
  '#1d4ed8',
  '#1e40af',
  // Purples
  '#8b5cf6',
  '#7c3aed',
  '#6d28d9',
  '#5b21b6',
  '#4c1d95',
  // Pinks
  '#ec4899',
  '#db2777',
  '#be185d',
  '#9d174d',
  '#831843',
  // Reds
  '#ef4444',
  '#dc2626',
  '#b91c1c',
  '#991b1b',
  '#7f1d1d',
  // Oranges
  '#f97316',
  '#ea580c',
  '#c2410c',
  '#9a3412',
  '#7c2d12',
  // Yellows
  '#eab308',
  '#ca8a04',
  '#a16207',
  '#854d0e',
  '#713f12',
  // Greens
  '#22c55e',
  '#16a34a',
  '#15803d',
  '#166534',
  '#14532d',
  // Teals
  '#14b8a6',
  '#0d9488',
  '#0f766e',
  '#115e59',
  '#134e4a',
  // Grays
  '#6b7280',
  '#4b5563',
  '#374151',
  '#1f2937',
  '#111827',
]

interface ColorPickerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

export function ColorPicker({ value, onChange, disabled = false, className }: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const [customColor, setCustomColor] = useState(value)

  // Update custom color input when value prop changes
  useEffect(() => {
    setCustomColor(value)
  }, [value])

  // Check if a color is valid hex
  const isValidHex = (color: string) => {
    return /^#([0-9A-F]{3}){1,2}$/i.test(color)
  }

  // Handle selecting a predefined color
  const handleColorSelect = (color: string) => {
    onChange(color)
    setCustomColor(color)
    setOpen(false)
  }

  // Handle custom color input change
  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value
    setCustomColor(newColor)
  }

  // Apply custom color when input is valid and blurred or enter is pressed
  const applyCustomColor = () => {
    if (isValidHex(customColor)) {
      onChange(customColor)
    } else {
      // Reset to current value if invalid
      setCustomColor(value)
    }
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      applyCustomColor()
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          className={cn('h-10 justify-between px-3', className)}
          disabled={disabled}>
          <div className='mr-2 h-6 w-6 rounded' style={{ backgroundColor: value }} />
          <span className='text-xs'>{value}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-64 p-3' align='start'>
        <div className='space-y-3'>
          {/* Color preview */}
          <div className='flex items-center'>
            <div
              className='mr-3 h-10 w-10 rounded'
              style={{ backgroundColor: isValidHex(customColor) ? customColor : value }}
            />
            <div>
              <Label htmlFor='custom-color'>Custom Color</Label>
              <Input
                id='custom-color'
                value={customColor}
                onChange={handleCustomColorChange}
                onBlur={applyCustomColor}
                onKeyDown={handleInputKeyDown}
                className='mt-1 h-8'
                maxLength={7}
              />
            </div>
          </div>

          {/* Color grid */}
          <div>
            <Label className='mb-2 block text-xs text-muted-foreground'>Predefined Colors</Label>
            <div className='grid grid-cols-5 gap-2'>
              {colorPalette.map((color) => (
                <button
                  key={color}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full',
                    'border transition-all focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-background'
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => handleColorSelect(color)}>
                  {value.toLowerCase() === color.toLowerCase() && (
                    <Check className='h-4 w-4 text-white' />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Form-connected version for use with react-hook-form
export function FormColorPicker({
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

  return <ColorPicker value={value} onChange={handleChange} {...props} />
}
