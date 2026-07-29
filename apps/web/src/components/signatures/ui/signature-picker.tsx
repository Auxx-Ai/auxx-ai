// apps/web/src/components/signatures/ui/signature-picker.tsx
'use client'

import type { SelectOption } from '@auxx/types/custom-field'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { type ComponentProps, useCallback, useMemo, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { type SignatureItem, useSignatureAccess, useSignatures } from '../hooks'
import { SignatureDialog } from './signature-dialog'

/** Props for SignaturePicker component */
interface SignaturePickerProps
  extends Pick<ComponentProps<typeof PopoverContent>, 'align' | 'side' | 'sideOffset'> {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  selected?: string | null
  onChange?: (signatureId: string | null) => void
  className?: string
  signatures?: SignatureItem[]
  /** Styling for the shared picker trigger. */
  triggerProps?: PickerTriggerOptions
  children?: React.ReactNode
  disabled?: boolean
}

/**
 * SignaturePicker - Popover-based picker for selecting a signature.
 * Uses MultiSelectPicker in single-select mode.
 */
export function SignaturePicker({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  selected,
  onChange,
  className,
  signatures: externalSignatures,
  triggerProps,
  children,
  disabled = false,
  ...popoverContentProps
}: SignaturePickerProps) {
  // Internal state for uncontrolled mode
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = controlledOpen ?? internalOpen
  const setIsOpen = controlledOnOpenChange ?? setInternalOpen

  // Create-signature dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  // Fetch signatures if not provided
  const { signatures: fetchedSignatures } = useSignatures()
  // Creating a signature is the coarse `signatures.manage` rung — instance-less,
  // so it takes no id. Without it the "Add New Signature" row would open a
  // dialog whose submit 403s.
  const { canCreate } = useSignatureAccess()
  const signatures = externalSignatures ?? fetchedSignatures
  const selectedSignature = signatures.find((signature) => signature.id === selected)

  // Convert signatures to SelectOption format
  const options: SelectOption[] = useMemo(() => {
    return signatures.map((sig) => ({
      value: sig.id,
      label: sig.name,
    }))
  }, [signatures])

  // Handle selection
  const handleChange = useCallback(
    (newSelected: string[]) => {
      onChange?.(newSelected[0] ?? null)
    },
    [onChange]
  )

  // Close popover on single select
  const handleSelectSingle = useCallback(() => {
    setIsOpen(false)
  }, [setIsOpen])

  // Open the create-signature dialog
  const handleCreate = useCallback(() => {
    setCreateDialogOpen(true)
  }, [])

  // Auto-select the newly created signature and close the picker
  const handleCreated = useCallback(
    (signatureId: string) => {
      onChange?.(signatureId)
      setIsOpen(false)
    },
    [onChange, setIsOpen]
  )

  /** Clears the optional signature selection without opening the picker. */
  const handleClear = useCallback(() => onChange?.(null), [onChange])

  const trigger = children ?? (
    <PickerTrigger
      open={isOpen}
      disabled={disabled}
      variant={triggerProps?.variant ?? 'transparent'}
      size={triggerProps?.size}
      hasValue={!!selectedSignature}
      placeholder='No signature'
      showClear={triggerProps?.showClear ?? true}
      onClear={handleClear}
      icon={triggerProps?.icon}
      iconPosition={triggerProps?.iconPosition}
      hideIcon={triggerProps?.hideIcon}
      asCombobox
      className={triggerProps?.className}>
      <span className='truncate'>{selectedSignature?.name}</span>
    </PickerTrigger>
  )

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className={cn('w-[250px] p-0', className)} {...popoverContentProps}>
        <MultiSelectPicker
          options={options}
          value={selected ? [selected] : []}
          onChange={handleChange}
          onSelectSingle={handleSelectSingle}
          placeholder='Search signatures...'
          canManage={false}
          canAdd={false}
          multi={false}
          onCreate={canCreate ? handleCreate : undefined}
          createLabel='Add New Signature'
          disabled={disabled}
        />
      </PopoverContent>
      {createDialogOpen && (
        <SignatureDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onSuccess={handleCreated}
        />
      )}
    </Popover>
  )
}
