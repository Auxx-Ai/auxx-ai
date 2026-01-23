// apps/web/src/components/pickers/actor-picker/actor-picker.tsx

'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { User, Users, ChevronsUpDown } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { cn } from '@auxx/ui/lib/utils'
import { ActorPickerContent, type ActorPickerContentProps } from './actor-picker-content'
import { useActor } from '~/components/resources/hooks/use-actor'
import type { ActorId } from '@auxx/types/actor'
import { parseActorId } from '@auxx/types/actor'

/**
 * Props for ActorPicker component
 */
export interface ActorPickerProps
  extends Omit<ActorPickerContentProps, 'onCaptureChange' | 'className'> {
  /** Custom trigger element (if not provided, uses default button) */
  children?: ReactNode

  /** Popover open state (controlled) */
  open?: boolean

  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void

  /** Default trigger: label when no items selected */
  emptyLabel?: string

  /** Popover alignment */
  align?: 'start' | 'center' | 'end'

  /** Popover side */
  side?: 'top' | 'bottom' | 'left' | 'right'

  /** Popover side offset */
  sideOffset?: number

  /** Additional className for popover content */
  contentClassName?: string

  /** Additional className for trigger button */
  triggerClassName?: string
}

/**
 * ActorPicker - A popover wrapper around ActorPickerContent.
 * Provides a complete dropdown experience for selecting actors.
 *
 * Features:
 * - Custom trigger support via children
 * - Default button trigger showing selection
 * - Controlled or uncontrolled open state
 * - Auto-close on single select
 */
export function ActorPicker({
  children,
  open,
  onOpenChange,
  emptyLabel = 'Select...',
  align = 'start',
  side = 'bottom',
  sideOffset = 5,
  contentClassName,
  triggerClassName,
  value,
  onChange,
  multi = true,
  onSelectSingle,
  disabled,
  ...pickerProps
}: ActorPickerProps) {
  // Internal open state (for uncontrolled mode)
  const [internalOpen, setInternalOpen] = useState(false)

  // Use controlled or uncontrolled state
  const isOpen = open ?? internalOpen

  /**
   * Handle open state changes
   */
  const handleOpenChange = (newOpen: boolean) => {
    if (open === undefined) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen)
  }

  /**
   * Handle single select - close popover after selection
   */
  const handleSelectSingle = (actorId: ActorId) => {
    onSelectSingle?.(actorId)
    handleOpenChange(false)
  }

  // Sync internal state with controlled state
  useEffect(() => {
    if (open !== undefined && open !== internalOpen) {
      setInternalOpen(open)
    }
  }, [open])

  // Custom trigger or default button
  const triggerElement = children ? (
    children
  ) : (
    <DefaultTrigger
      value={value}
      emptyLabel={emptyLabel}
      multi={multi}
      disabled={disabled}
      className={triggerClassName}
    />
  )

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{triggerElement}</PopoverTrigger>
      <PopoverContent
        className={cn('w-72 p-0', contentClassName)}
        align={align}
        side={side}
        sideOffset={sideOffset}>
        <ActorPickerContent
          value={value}
          onChange={onChange}
          multi={multi}
          onSelectSingle={multi ? undefined : handleSelectSingle}
          disabled={disabled}
          {...pickerProps}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Default trigger button showing current selection
 */
function DefaultTrigger({
  value,
  emptyLabel,
  multi,
  disabled,
  className,
}: {
  value: ActorId[]
  emptyLabel: string
  multi: boolean
  disabled?: boolean
  className?: string
}) {
  // For single select with a value, show the actor
  if (!multi && value.length === 1) {
    return (
      <Button
        variant="outline"
        role="combobox"
        disabled={disabled}
        className={cn('justify-between', className)}>
        <ActorInline actorId={value[0]!} />
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </Button>
    )
  }

  // For multi select or empty, show label
  const label =
    value.length === 0
      ? emptyLabel
      : value.length === 1
        ? '1 selected'
        : `${value.length} selected`

  return (
    <Button
      variant="outline"
      role="combobox"
      disabled={disabled}
      className={cn('justify-between', className)}>
      <span className={value.length === 0 ? 'text-muted-foreground' : ''}>{label}</span>
      <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
    </Button>
  )
}

/**
 * Inline display for single-select value in button
 */
function ActorInline({ actorId }: { actorId: ActorId }) {
  const { actor } = useActor({ actorId })
  const { type } = parseActorId(actorId)

  return (
    <div className="flex items-center gap-2">
      <Avatar className="size-5">
        <AvatarImage src={actor?.avatarUrl ?? undefined} />
        <AvatarFallback className="text-[10px]">
          {type === 'user' ? <User className="size-3" /> : <Users className="size-3" />}
        </AvatarFallback>
      </Avatar>
      <span>{actor?.name ?? 'Loading...'}</span>
    </div>
  )
}
