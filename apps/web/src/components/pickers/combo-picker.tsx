import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Check } from 'lucide-react'
import React, { useCallback, useMemo, useState } from 'react'

/**
 * Custom CommandItem that doesn't close the popover on selection in multi-select mode
 */
function NonClosingCommandItem({
  keepOpen,
  onCustomSelect,
  onSelect,
  ...props
}: React.ComponentProps<typeof CommandItem> & {
  keepOpen?: boolean
  onCustomSelect?: () => void
}) {
  // Custom handler to intercept the default selection behavior
  const handleSelect = useCallback(
    (value: string) => {
      if (onCustomSelect) {
        onCustomSelect()
      }

      if (onSelect) {
        onSelect(value)
      }

      // Return true to close, false to keep open
      return !keepOpen
    },
    [onCustomSelect, onSelect, keepOpen]
  )

  return <CommandItem onSelect={handleSelect} {...props} />
}
/** Single option for the picker */
export type Option = { value: string; label: string; color?: string; iconId?: string }

/** Group of options with a label */
export type OptionGroup = { label: string; options: Option[] }

/**
 * Props for the ComboPicker component
 * @property options - Array of available options (flat list)
 * @property groups - Array of option groups (takes precedence over options if provided)
 * @property selected - Currently selected option(s)
 * @property searchPlaceholder - Placeholder text for search input
 * @property showSearch - Whether to show search input
 * @property onChange - Callback when selection changes
 * @property open - Whether the picker is open
 * @property onOpen - Callback when picker opens
 * @property onClose - Callback when picker closes
 * @property disabled - Whether the picker is disabled
 * @property className - Additional CSS classes
 * @property multi - Whether multiple selection is allowed
 * @property children - Trigger element
 * @property popover - Whether to use popover UI
 */
interface ComboPickerProps {
  options?: Option[]
  groups?: OptionGroup[]
  selected: Option[] | Option | null
  searchPlaceholder?: string
  showSearch?: boolean
  onChange: (value: Option[] | Option | null) => void
  open: boolean
  onOpen?: () => void
  onClose: (e?: unknown) => void
  disabled?: boolean
  className?: string
  multi?: boolean // default true
  children: React.ReactNode // trigger element
  popover?: boolean // default true
}

/**
 * ComboPicker component
 * A versatile picker component that supports both single and multi-select modes,
 * with optional search functionality and popover UI.
 *
 * @param options - Array of available options
 * @param selected - Currently selected option(s)
 * @param searchPlaceholder - Placeholder text for search input
 * @param showSearch - Whether to show search input
 * @param onChange - Callback when selection changes
 * @param open - Whether the picker is open
 * @param onOpen - Callback when picker opens
 * @param onClose - Callback when picker closes
 * @param disabled - Whether the picker is disabled
 * @param className - Additional CSS classes
 * @param multi - Whether multiple selection is allowed
 * @param children - Trigger element
 * @param popover - Whether to use popover UI
 */
export function ComboPicker({
  options = [],
  groups,
  selected,
  searchPlaceholder = 'Search...',
  showSearch = true,
  onChange,
  open,
  onOpen,
  onClose,
  disabled = false,
  className,
  multi = true,
  children,
  popover = true,
  ...props
}: ComboPickerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  // Maintain internal state that updates when props change
  const [internalSelected, setInternalSelected] = useState<Option[] | Option | null>(selected)

  // Update internal state when prop changes
  React.useEffect(() => {
    setInternalSelected(selected)
  }, [selected])

  // Flatten all options (from groups or flat options)
  const allOptions = useMemo(() => {
    if (groups) {
      return groups.flatMap((g) => g.options)
    }
    return options
  }, [groups, options])

  // Filter options by search (flat list)
  const filteredOptions = useMemo(() => {
    if (!searchQuery) return allOptions
    return allOptions.filter((opt) => opt.label.toLowerCase().includes(searchQuery.toLowerCase()))
  }, [allOptions, searchQuery])

  // Filter groups by search
  const filteredGroups = useMemo(() => {
    if (!groups) return null
    if (!searchQuery) return groups

    return groups
      .map((group) => ({
        ...group,
        options: group.options.filter((opt) =>
          opt.label.toLowerCase().includes(searchQuery.toLowerCase())
        ),
      }))
      .filter((group) => group.options.length > 0)
  }, [groups, searchQuery])

  // Toggle selection
  const toggleOption = (value: string) => {
    if (multi) {
      const arrSelected = Array.isArray(internalSelected) ? internalSelected : []
      const isSelected = arrSelected.some((opt) => opt.value === value)

      let newSelected: Option[]
      if (isSelected) {
        newSelected = arrSelected.filter((opt) => opt.value !== value)
      } else {
        const found = allOptions.find((opt) => opt.value === value)
        newSelected = found ? [...arrSelected, found] : [...arrSelected]
      }

      setInternalSelected(newSelected)
      onChange(newSelected)
    } else {
      const found = allOptions.find((opt) => opt.value === value) || null
      setInternalSelected(found)
      onChange(found)
    }
  }

  // For single-select, highlight the selected option
  const isOptionSelected = (opt: Option) => {
    if (multi) {
      return Array.isArray(internalSelected) && internalSelected.some((s) => s.value === opt.value)
    } else {
      return (
        internalSelected && !Array.isArray(internalSelected) && internalSelected.value === opt.value
      )
    }
  }

  /** Render a single option item */
  const renderOption = (opt: Option) => {
    const selected = isOptionSelected(opt)
    return (
      <CommandItem
        key={opt.value}
        value={opt.label}
        onSelect={() => {
          toggleOption(opt.value)
        }}
        className={cn('flex items-center', selected ? 'font-medium' : '')}
        disabled={disabled}>
        {opt.iconId ? (
          <EntityIcon iconId={opt.iconId} color={opt.color || 'gray'} size='sm' className='me-1' />
        ) : null}
        <span>{opt.label}</span>
        <Check className={cn('ml-auto h-4 w-4', selected ? 'opacity-100' : 'opacity-0')} />
      </CommandItem>
    )
  }

  const commandUI = (
    <Command>
      {showSearch && (
        <CommandInput
          placeholder={searchPlaceholder}
          value={searchQuery}
          onValueChange={setSearchQuery}
          disabled={disabled}
        />
      )}
      <CommandList>
        <CommandEmpty>{searchQuery ? 'No options found.' : 'No options available.'}</CommandEmpty>
        {filteredGroups
          ? filteredGroups.map((group, idx) => (
              <React.Fragment key={group.label}>
                {idx > 0 && <CommandSeparator />}
                <CommandGroup heading={group.label}>
                  {group.options.map((opt) => renderOption(opt))}
                </CommandGroup>
              </React.Fragment>
            ))
          : filteredOptions.map((opt) => renderOption(opt))}
      </CommandList>
    </Command>
  )

  if (!popover) {
    return <div className={className}>{commandUI}</div>
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (v) {
          onOpen?.()
        } else if (!multi) {
          // Only close if it's not in multi-select mode or explicitly closing
          onClose()
        }
      }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className={cn('min-w-[300px] p-0', className)} {...props}>
        {commandUI}
      </PopoverContent>
    </Popover>
  )
}
