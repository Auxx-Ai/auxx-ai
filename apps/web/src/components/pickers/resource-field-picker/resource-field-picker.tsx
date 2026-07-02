// apps/web/src/components/pickers/resource-field-picker/resource-field-picker.tsx

'use client'

import { isFieldPath, parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { EntityIcon } from '@auxx/ui/components/icons'
import {
  Popover,
  PopoverAnchor,
  PopoverContentDialogAware,
  PopoverTrigger,
} from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useEffect, useRef, useState } from 'react'
import { useField } from '~/components/resources/hooks/use-field'
import { useResources } from '~/components/resources/hooks/use-resources'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { ResourceFieldPickerContent } from './resource-field-picker-content'
import type { ResourceFieldPickerProps } from './types'

/**
 * ResourceFieldPicker — a popover wrapper around {@link ResourceFieldPickerContent}.
 * Lets the user first pick a resource, then drill down its fields (and any
 * relationship hops) in a single unified breadcrumb, and emits the selected
 * entity-scoped `FieldReference`.
 *
 * Mirrors `ResourcePicker`'s popover ergonomics (custom trigger, `anchorRef`,
 * dialog-aware content, auto-close on select).
 */
export function ResourceFieldPicker({
  children,
  open,
  onOpenChange,
  anchorRef,
  emptyLabel = 'Select field...',
  align = 'start',
  side = 'bottom',
  sideOffset = 5,
  contentClassName,
  triggerProps,
  value,
  onSelect,
  disabled,
  closeOnSelect = true,
  ...contentProps
}: ResourceFieldPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const isOpen = open ?? internalOpen

  const { getResourceById } = useResources()

  const handleOpenChange = (newOpen: boolean) => {
    if (open === undefined) setInternalOpen(newOpen)
    onOpenChange?.(newOpen)
  }

  // Sync internal state with controlled state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: internalOpen intentionally excluded to avoid a loop
  useEffect(() => {
    if (open !== undefined && open !== internalOpen) setInternalOpen(open)
  }, [open])

  // Resolve the selected value for the default trigger: root resource (for the
  // icon) + terminal field (for the label).
  const hasValue = value !== undefined
  const rootRfId: ResourceFieldId | undefined = value
    ? isFieldPath(value)
      ? value[0]
      : (value as ResourceFieldId)
    : undefined
  const terminalRfId: ResourceFieldId | undefined = value
    ? isFieldPath(value)
      ? value[value.length - 1]
      : (value as ResourceFieldId)
    : undefined
  const selectedResource = rootRfId
    ? getResourceById(parseResourceFieldId(rootRfId).entityDefinitionId)
    : undefined
  const terminalField = useField(terminalRfId ?? null)

  const triggerElement = children ? (
    children
  ) : (
    <PickerTrigger
      open={isOpen}
      disabled={disabled}
      variant={triggerProps?.variant ?? 'transparent'}
      hasValue={hasValue}
      placeholder={emptyLabel}
      showClear={triggerProps?.showClear ?? false}
      hideIcon={triggerProps?.hideIcon}
      className={triggerProps?.className}>
      {selectedResource && (
        <div className='flex items-center gap-2 min-w-0'>
          <EntityIcon
            iconId={selectedResource.icon ?? 'circle'}
            color={selectedResource.color ?? 'gray'}
            size='sm'
            inverse
            className='inset-shadow-xs inset-shadow-black/20'
          />
          <span className='truncate text-sm'>{terminalField?.label ?? selectedResource.label}</span>
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
        className={cn('w-72 p-0', contentClassName)}
        align={align}
        side={side}
        sideOffset={sideOffset}
        onOpenAutoFocus={(e) => {
          if (anchorRef) {
            e.preventDefault()
            requestAnimationFrame(() => {
              const input = contentRef.current?.querySelector('input')
              input?.focus()
            })
          }
        }}
        onFocusOutside={(e) => {
          if (anchorRef) e.preventDefault()
        }}>
        <ResourceFieldPickerContent
          {...contentProps}
          value={value}
          onSelect={onSelect}
          closeOnSelect={closeOnSelect}
          onClose={() => handleOpenChange(false)}
        />
      </PopoverContentDialogAware>
    </Popover>
  )
}
