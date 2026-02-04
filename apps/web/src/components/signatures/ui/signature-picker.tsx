// apps/web/src/components/signatures/ui/signature-picker.tsx
'use client'

import { useState, useMemo, useCallback, type ComponentProps } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Button } from '@auxx/ui/components/button'
import { useRouter } from 'next/navigation'
import { cn } from '@auxx/ui/lib/utils'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import type { SelectOption } from '@auxx/types/custom-field'
import { useSignatures, type SignatureItem } from '../hooks'

/** Props for SignaturePicker component */
interface SignaturePickerProps extends Pick<ComponentProps<typeof PopoverContent>, 'align' | 'side' | 'sideOffset'> {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  selected?: string | null
  onChange?: (signatureId: string | null) => void
  className?: string
  signatures?: SignatureItem[]
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
  children,
  disabled = false,
  ...popoverContentProps
}: SignaturePickerProps) {
  const router = useRouter()

  // Internal state for uncontrolled mode
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = controlledOpen ?? internalOpen
  const setIsOpen = controlledOnOpenChange ?? setInternalOpen

  // Fetch signatures if not provided
  const { signatures: fetchedSignatures } = useSignatures()
  const signatures = externalSignatures ?? fetchedSignatures

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

  // Navigate to create new signature
  const handleCreate = useCallback(() => {
    router.push('/app/settings/signatures/new')
  }, [router])

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children ?? <Button variant="outline">Select Signature</Button>}
      </PopoverTrigger>
      <PopoverContent className={cn('w-[250px] p-0', className)} {...popoverContentProps}>
        <MultiSelectPicker
          options={options}
          value={selected ? [selected] : []}
          onChange={handleChange}
          onSelectSingle={handleSelectSingle}
          placeholder="Search signatures..."
          canManage={false}
          canAdd={false}
          multi={false}
          onCreate={handleCreate}
          createLabel="Add New Signature"
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}
