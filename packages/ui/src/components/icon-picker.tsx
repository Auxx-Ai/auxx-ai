// packages/ui/src/components/icon-picker.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Circle, Search, X } from 'lucide-react'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_COLOR,
  getIcon,
  getIconColor,
  ICON_COLORS,
  ICON_DATA,
  type IconColor,
  type IconItem,
} from './icons'

/** Memoized icon button component - uses CSS custom properties for color */
const IconButton = React.memo<{
  item: IconItem
  onSelect: (iconId: string) => void
}>(({ item, onSelect }) => {
  const Icon = item.icon
  return (
    <button
      className='flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors bg-[var(--icon-bg)] hover:bg-[var(--icon-bg-hover)] text-[var(--icon-color)]'
      onClick={() => onSelect(item.id)}
      data-icon-id={item.id}>
      <Icon className='size-4' />
    </button>
  )
})

IconButton.displayName = 'IconButton'

/** Memoized color button component */
const ColorButton = React.memo<{
  color: IconColor
  isActive: boolean
  onClick: () => void
}>(({ color, isActive, onClick }) => (
  <button
    className={cn(
      'size-5 rounded-full transition-all',
      color.swatch,
      isActive && 'ring-2 ring-offset-2 ring-info'
    )}
    onClick={onClick}
    title={color.label}
  />
))

ColorButton.displayName = 'ColorButton'

/** Icon picker value */
export interface IconPickerValue {
  /** Icon ID, e.g., "home", "settings", "user" */
  icon: string
  /** Color ID, e.g., "blue", "red", "gray" */
  color: string
}

/** Icon picker props */
export interface IconPickerProps {
  /** Current value */
  value?: IconPickerValue
  /** Called when value changes */
  onChange: (value: IconPickerValue) => void
  /** Whether the picker is disabled */
  disabled?: boolean
  /** Additional classes */
  className?: string
  /** Popover alignment */
  align?: 'start' | 'end'
  /** Controlled open state */
  open?: boolean
  /** Called when open state changes */
  onOpenChange?: (open: boolean) => void
  /** Custom trigger element */
  children?: React.ReactNode
  /** Set to false when used inside a Dialog to fix scroll issues */
  modal?: boolean
}

/** Icon picker component */
export function IconPicker({
  value,
  onChange,
  disabled = false,
  className,
  align = 'start',
  onOpenChange,
  open,
  children,
  modal = true,
}: IconPickerProps) {
  // Use internal state if open is not provided (uncontrolled mode)
  const [internalOpen, setInternalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedColor, setSelectedColor] = useState(value?.color ?? DEFAULT_COLOR)
  const [hoveredIconId, setHoveredIconId] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Determine if component is in controlled or uncontrolled mode
  const isControlled = open !== undefined && onOpenChange !== undefined
  const isOpen = isControlled ? open : internalOpen

  // Get the selected color object
  const selectedColorObj = getIconColor(selectedColor)

  // Handle open state changes based on mode
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (isControlled && onOpenChange) {
        onOpenChange(newOpen)
      } else {
        setInternalOpen(newOpen)
      }
      // Reset search when closing
      if (!newOpen) {
        setSearchQuery('')
      }
    },
    [isControlled, onOpenChange]
  )

  // Filter icons based on search query
  const filteredIcons = useMemo(() => {
    if (!searchQuery.trim()) {
      return ICON_DATA
    }

    const query = searchQuery.toLowerCase()
    return ICON_DATA.filter((item) => {
      return item.label.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)
    })
  }, [searchQuery])

  // Handle icon selection
  const handleIconSelect = useCallback(
    (iconId: string) => {
      onChange({ icon: iconId, color: selectedColor })
      handleOpenChange(false)
    },
    [onChange, selectedColor, handleOpenChange]
  )

  // Handle color selection
  const handleColorSelect = useCallback(
    (colorId: string) => {
      setSelectedColor(colorId)
      // If there's already a selected icon, update the value with new color
      if (value?.icon) {
        onChange({ icon: value.icon, color: colorId })
      }
    },
    [value, onChange]
  )

  // Get current icon for display
  const currentIcon = value?.icon ? getIcon(value.icon) : null
  const currentColor = value?.color ? getIconColor(value.color) : getIconColor(DEFAULT_COLOR)

  // Get hovered icon data for label display
  const hoveredIcon = hoveredIconId ? getIcon(hoveredIconId) : null

  /** Handle mouse events on the icon grid for hover detection */
  const handleGridMouseOver = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest('button[data-icon-id]')
    if (button) {
      setHoveredIconId(button.getAttribute('data-icon-id'))
    }
  }, [])

  const handleGridMouseLeave = useCallback(() => {
    setHoveredIconId(null)
  }, [])

  // Default trigger if none provided
  const defaultTrigger = (
    <Button
      variant='outline'
      size='icon'
      className={cn('h-10 w-10', className)}
      disabled={disabled}>
      {currentIcon ? (
        <div className={cn('flex items-center justify-center', currentColor.iconColor)}>
          <currentIcon.icon className='size-5' />
        </div>
      ) : (
        <Circle className='size-5 text-muted-foreground' />
      )}
    </Button>
  )

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange} modal={modal}>
      <PopoverTrigger asChild>{children || defaultTrigger}</PopoverTrigger>
      <PopoverContent className='w-90 p-0' align={align}>
        {/* Search input */}
        <div className='flex items-center border-b px-3 py-0.5'>
          <Search className='mr-2 size-4 shrink-0 opacity-50' />
          <Input
            placeholder='Search icons...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='h-7 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0'
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className='flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary-100 hover:bg-bad-100 hover:text-bad-500'>
              <X className='size-3' />
            </button>
          )}
        </div>
        {/* Color selector bar */}
        <div className='border-b p-2'>
          <div className='flex justify-start gap-2'>
            {ICON_COLORS.map((color) => (
              <ColorButton
                key={color.id}
                color={color}
                isActive={selectedColor === color.id}
                onClick={() => handleColorSelect(color.id)}
              />
            ))}
          </div>
        </div>
        {/* Icon grid */}
        <div
          className='relative h-64 overflow-y-auto p-2 pb-8'
          ref={scrollContainerRef}
          onWheel={(e) => e.stopPropagation()}
          onMouseOver={handleGridMouseOver}
          onMouseLeave={handleGridMouseLeave}>
          {filteredIcons.length > 0 ? (
            <div className={cn('grid grid-cols-10 gap-0.5', selectedColorObj.groupClasses)}>
              {filteredIcons.map((item) => (
                <IconButton key={item.id} item={item} onSelect={handleIconSelect} />
              ))}
            </div>
          ) : (
            <div className='flex h-full items-center justify-center text-muted-foreground'>
              No icons found
            </div>
          )}

          {/* Hovered icon label */}
        </div>
        {hoveredIcon && (
          <Badge variant='zinc' size='sm' className='pointer-events-none absolute bottom-2 left-2 '>
            {hoveredIcon.label}
          </Badge>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Form-connected version for use with react-hook-form */
export const FormIconPicker: React.FC<
  Omit<IconPickerProps, 'value' | 'onChange'> & {
    value?: IconPickerValue
    onChange?: (value: IconPickerValue) => void
    onBlur?: () => void
  }
> = ({ value = { icon: 'circle', color: 'gray' }, onChange, onBlur, ...props }) => {
  const handleChange = useCallback(
    (newValue: IconPickerValue) => {
      onChange?.(newValue)
    },
    [onChange]
  )

  return <IconPicker value={value} onChange={handleChange} {...props} />
}
