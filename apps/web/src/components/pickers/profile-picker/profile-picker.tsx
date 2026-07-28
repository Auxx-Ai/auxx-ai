// apps/web/src/components/pickers/profile-picker/profile-picker.tsx

'use client'

import {
  Popover,
  PopoverAnchor,
  PopoverContentDialogAware,
  PopoverTrigger,
} from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { ProfileGlyph } from './profile-item'
import { ProfilePickerContent } from './profile-picker-content'
import type { ProfilePickerProps } from './types'

/**
 * ProfilePicker — the ONE permission-profile picker.
 *
 * A popover wrapper around {@link ProfilePickerContent}, used by every surface
 * that binds a profile to a principal: member detail, the members bulk apply
 * dialog, the agent builder's Permissions tab and the agents bulk apply dialog.
 * The caller decides *which* profiles are legal for its principal (seat class,
 * rank, `appliesTo`) and passes them as `options`; the picker only renders and
 * searches them.
 *
 * Single-valued by construction — a member and an agent each bind exactly one
 * profile — so there is no multi mode and no clear affordance: a principal
 * always resolves *some* profile, and unbinding is not a state the server has.
 */
export function ProfilePicker({
  children,
  open,
  onOpenChange,
  anchorRef,
  emptyLabel = 'Select a profile...',
  hint,
  align = 'start',
  side = 'bottom',
  sideOffset = 5,
  contentClassName,
  triggerProps,
  value,
  onChange,
  options,
  disabled,
  ...pickerProps
}: ProfilePickerProps) {
  // Internal open state (for uncontrolled mode)
  const [internalOpen, setInternalOpen] = useState(false)

  // Ref for content to focus input when using anchorRef
  const contentRef = useRef<HTMLDivElement>(null)

  const isOpen = open ?? internalOpen

  const handleOpenChange = (newOpen: boolean) => {
    if (open === undefined) setInternalOpen(newOpen)
    onOpenChange?.(newOpen)
  }

  /** Single select — close the popover once a profile is picked. */
  const handleSelectSingle = () => handleOpenChange(false)

  // Sync internal state with controlled state
  // biome-ignore lint/correctness/useExhaustiveDependencies: internalOpen is intentionally excluded to avoid infinite loop
  useEffect(() => {
    if (open !== undefined && open !== internalOpen) setInternalOpen(open)
  }, [open])

  const selected = useMemo(
    () => options.find((o) => o.profile.id === value)?.profile,
    [options, value]
  )

  const triggerElement = children ? (
    children
  ) : (
    <PickerTrigger
      open={isOpen}
      disabled={disabled}
      variant={triggerProps?.variant ?? 'transparent'}
      hasValue={!!selected}
      placeholder={emptyLabel}
      showClear={triggerProps?.showClear ?? false}
      hideIcon={triggerProps?.hideIcon}
      className={triggerProps?.className}>
      {selected && (
        <div className='flex min-w-0 items-center gap-2'>
          <ProfileGlyph profile={selected} className='shrink-0' />
          <span className='truncate text-sm'>{selected.name}</span>
          {hint && <span className='shrink-0 truncate text-xs text-muted-foreground'>{hint}</span>}
        </div>
      )}
    </PickerTrigger>
  )

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      {anchorRef ? (
        <PopoverAnchor virtualRef={anchorRef} />
      ) : (
        <PopoverTrigger asChild>{triggerElement}</PopoverTrigger>
      )}
      <PopoverContentDialogAware
        ref={contentRef}
        className={cn('w-80 p-0', contentClassName)}
        align={align}
        side={side}
        sideOffset={sideOffset}
        onOpenAutoFocus={(e) => {
          // Prevent default focus behavior when using anchorRef, then focus the input manually
          if (anchorRef) {
            e.preventDefault()
            requestAnimationFrame(() => {
              const input = contentRef.current?.querySelector('input')
              input?.focus()
            })
          }
        }}
        onFocusOutside={(e) => {
          // Prevent closing on focus changes when using anchorRef
          if (anchorRef) e.preventDefault()
        }}>
        <ProfilePickerContent
          value={value}
          onChange={onChange}
          options={options}
          onSelectSingle={handleSelectSingle}
          onManage={() => handleOpenChange(false)}
          disabled={disabled}
          {...pickerProps}
        />
      </PopoverContentDialogAware>
    </Popover>
  )
}
