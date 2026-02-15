// apps/web/src/components/pickers/field-picker/field-picker.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ChevronDown } from 'lucide-react'
import { useCallback, useState } from 'react'
import { FieldPickerContent } from './field-picker-content'
import type { FieldPickerProps } from './types'

/**
 * FieldPicker - Standalone field picker with popover.
 * Allows selecting fields from a resource definition with relationship drill-down.
 */
export function FieldPicker({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  trigger,
  align = 'start',
  width = 280,
  entityDefinitionId,
  fieldReferences,
  excludeFields,
  onSelect,
  mode = 'single',
  closeOnSelect = mode === 'single',
  onCreateField,
  searchPlaceholder,
}: FieldPickerProps) {
  // Support both controlled and uncontrolled modes
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (isControlled) {
        controlledOnOpenChange?.(newOpen)
      } else {
        setInternalOpen(newOpen)
      }
    },
    [isControlled, controlledOnOpenChange]
  )

  const handleClose = useCallback(() => {
    handleOpenChange(false)
  }, [handleOpenChange])

  // Default trigger
  const defaultTrigger = (
    <Button variant='outline' size='sm'>
      Select field
      <ChevronDown className='size-4 opacity-50' />
    </Button>
  )

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
      <PopoverContent
        className='p-0'
        align={align}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}>
        <FieldPickerContent
          entityDefinitionId={entityDefinitionId}
          fieldReferences={fieldReferences}
          excludeFields={excludeFields}
          onSelect={onSelect}
          mode={mode}
          closeOnSelect={closeOnSelect}
          onClose={handleClose}
          onCreateField={onCreateField}
          searchPlaceholder={searchPlaceholder}
        />
      </PopoverContent>
    </Popover>
  )
}
