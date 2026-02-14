// apps/web/src/components/custom-fields/ui/option-color-picker.tsx
'use client'

import {
  DEFAULT_SELECT_OPTION_COLOR,
  OPTION_COLORS,
  type SelectOptionColor,
} from '@auxx/lib/custom-fields/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'

interface OptionColorPickerProps {
  /** Current color value */
  value?: SelectOptionColor
  /** Callback when color changes */
  onChange: (color: SelectOptionColor) => void
  /** Whether the picker is disabled */
  disabled?: boolean
}

/**
 * Compact color picker for select option colors.
 * Renders as a small colored circle that opens a dropdown list of colors.
 */
export function OptionColorPicker({
  value = DEFAULT_SELECT_OPTION_COLOR,
  onChange,
  disabled = false,
}: OptionColorPickerProps) {
  const currentColor = OPTION_COLORS.find((c) => c.id === value) ?? OPTION_COLORS[0]!

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button variant='ghost' size='icon-sm' className='size-6' aria-label='Select color'>
          <div
            className={cn(
              'size-4 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10',
              currentColor.swatch
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-36'>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as SelectOptionColor)}>
          {OPTION_COLORS.map((color) => (
            <DropdownMenuRadioItem key={color.id} value={color.id} className='pl-1.5'>
              <div
                className={cn(
                  'size-3 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10 mr-2',
                  color.swatch
                )}
              />
              {color.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
