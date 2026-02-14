'use client'

import type { VariantProps } from 'class-variance-authority'
import { CommandLoading } from 'cmdk'
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react'
// packages/ui/src/components/combobox.tsx
import * as React from 'react'
import { cn } from '../lib/utils'
import { Button, type buttonVariants } from './button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

/** Button variant props extracted for type safety */
type ButtonVariantProps = VariantProps<typeof buttonVariants>

/** PopoverContent props that can be passed through to the popover */
type PopoverContentProps = React.ComponentProps<typeof PopoverContent>

/** Configuration for an "add new" action at the bottom of the dropdown */
interface ComboboxAddAction {
  /** Label to display (e.g., "New Status Attribute") */
  label: string
  /** Callback when the add action is clicked */
  onAdd: () => void
  /** Optional custom icon (defaults to Plus) */
  icon?: React.ReactNode
}

/** Props for the Combobox component */
interface ComboboxProps extends Omit<PopoverContentProps, 'children' | 'className'> {
  options: { value: string; label: string }[]
  placeholder: string
  emptyText: React.ReactNode
  value?: string
  onChangeValue: (value: string) => void
  loading?: boolean
  search?: string
  onSearch?: (value: string) => void
  /** Optional custom trigger element. If not provided, uses a default Button */
  trigger?: React.ReactNode
  /** Whether the combobox is disabled */
  disabled?: boolean
  /** Button variant - defaults to 'outline' */
  variant?: ButtonVariantProps['variant']
  /** Button size - defaults to 'default' */
  size?: ButtonVariantProps['size']
  /** Additional className for the trigger button */
  className?: string
  /** Optional action to add a new item, displayed at the bottom of the dropdown */
  addAction?: ComboboxAddAction
}

/**
 * Combobox component with search functionality
 */
export function Combobox(props: ComboboxProps) {
  const {
    value,
    onChangeValue,
    placeholder,
    emptyText,
    loading = false,
    trigger,
    disabled,
    variant = 'outline',
    size,
    className,
    addAction,
    // PopoverContent props
    align,
    alignOffset,
    sideOffset,
    side,
    ...popoverContentProps
  } = props
  const [open, setOpen] = React.useState(false)

  /** Default trigger button used when no custom trigger is provided */
  const defaultTrigger = (
    <Button
      variant={variant}
      size={size}
      role='combobox'
      aria-expanded={open}
      disabled={disabled}
      className={cn('justify-between', className)}>
      {(value && props.options.find((option) => option.value === value)?.label) ||
        value ||
        placeholder}
      <ChevronsUpDown className='shrink-0 opacity-50' />
    </Button>
  )

  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        side={side}
        className={cn('p-0 min-w-(--radix-popover-trigger-width) w-auto')}
        {...popoverContentProps}>
        <Command>
          <CommandInput
            placeholder='Search...'
            value={props.onSearch ? props.search : undefined}
            onValueChange={props.onSearch}
          />
          <CommandList>
            {loading && (
              <CommandLoading>
                <div className='flex items-center justify-center'>
                  <Loader2 className='m-4 size-4 animate-spin' />
                </div>
              </CommandLoading>
            )}
            <CommandEmpty>{emptyText}</CommandEmpty>
            {props.options.length ? (
              <CommandGroup>
                {props.options.map((options) => (
                  <CommandItem
                    key={options.value}
                    value={options.value}
                    onSelect={(currentValue) => {
                      onChangeValue(currentValue === value ? '' : currentValue)
                      setOpen(false)
                    }}>
                    <Check className={cn(value === options.value ? 'opacity-100' : 'opacity-0')} />
                    {options.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {addAction && (
              <CommandGroup>
                <CommandItem
                  value='__combobox_add_new__'
                  onSelect={() => {
                    addAction.onAdd()
                    setOpen(false)
                  }}>
                  {addAction.icon ?? <Plus className='text-muted-foreground' />}
                  {addAction.label}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
