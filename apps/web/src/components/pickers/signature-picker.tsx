// ~/components/pickers/signature-picker.tsx
'use client'

import React, { useState, useMemo } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Button } from '@auxx/ui/components/button'
import { Check, ChevronsUpDown, Signature } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { api } from '~/trpc/react'
import { useFormContext, FieldPath, FieldValues } from 'react-hook-form'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form' // Assuming you use shadcn's Form component
import { useRouter } from 'next/navigation'

// Assuming Signature type exists (adjust path if necessary)
// import { Signature } from '@auxx/database/types'; or from a types file
type Signature = {
  id: string
  name: string
  // other fields...
}

interface SignaturePickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** The selected signature ID or object */
  value?: string | Signature | null
  /** Callback when a signature is selected. Passes the full signature object. */
  onChange?: (selectedSignature: Signature | null) => void
  className?: string
  /** Optional pre-fetched signatures */
  initialSignatures?: Signature[]
  /** Custom trigger element */
  children?: React.ReactNode
  /** Placeholder for the search input */
  searchPlaceholder?: string
  /** Text for the empty state */
  emptyText?: string
  /** Heading for the command group */
  groupHeading?: string
  /** Optional explicit popover open state management */
  popoverOpen?: boolean
  /** Optional explicit popover open state change handler */
  onPopoverOpenChange?: (open: boolean) => void
  /** Disabled state */
  disabled?: boolean
}

export function SignaturePicker({
  value,
  onChange,
  className,
  initialSignatures,
  children,
  searchPlaceholder = 'Search signatures...',
  emptyText = 'No signatures found.',
  groupHeading = 'Available Signatures',
  popoverOpen: externalOpen,
  onPopoverOpenChange: externalOnOpenChange,
  disabled = false,
}: SignaturePickerProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const router = useRouter()

  // Use external state if provided, otherwise use internal state
  const isOpen = externalOpen ?? internalOpen
  const setIsOpen = externalOnOpenChange ?? setInternalOpen

  // Fetch signatures if not provided initially
  const { data: fetchedSignatures, isLoading } = api.signature.getAll.useQuery(
    undefined, // No input needed for getAll
    {
      enabled: !initialSignatures, // Only fetch if initialSignatures aren't provided
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    }
  )

  const signatures = initialSignatures || fetchedSignatures || []

  // Memoize the selected signature ID extraction
  const selectedSignatureId = useMemo(() => {
    if (!value) return null
    return typeof value === 'string' ? value : value.id
  }, [value])

  // Memoize the selected signature object
  const selectedSignature = useMemo(() => {
    if (!selectedSignatureId) return null
    return signatures.find((sig) => sig.id === selectedSignatureId) || null
  }, [selectedSignatureId, signatures])

  const handleSelect = (signature: Signature) => {
    onChange?.(signature)
    setIsOpen(false) // Close popover on selection
    setSearchValue('') // Reset search
  }

  // Filter signatures based on search
  const filteredSignatures = useMemo(() => {
    if (!searchValue) return signatures
    return signatures.filter((signature) =>
      signature.name.toLowerCase().includes(searchValue.toLowerCase())
    )
  }, [signatures, searchValue])

  const triggerLabel = selectedSignature ? selectedSignature.name : 'Pick a signature'

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {children || (
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={isOpen}
            className={cn(
              'w-[200px] justify-between',
              !selectedSignature && 'text-muted-foreground'
            )}>
            {triggerLabel}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className={cn('p-0', className)}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={searchValue}
            onValueChange={setSearchValue}
            disabled={isLoading && !initialSignatures} // Disable input while loading if needed
          />
          <CommandList>
            {isLoading && !initialSignatures && <CommandEmpty>Loading signatures...</CommandEmpty>}
            {!isLoading && filteredSignatures.length === 0 && (
              <CommandEmpty>{emptyText}</CommandEmpty>
            )}
            {!isLoading && filteredSignatures.length > 0 && (
              <CommandGroup heading={groupHeading}>
                {filteredSignatures.map((signature) => (
                  <CommandItem
                    key={signature.id}
                    value={signature.id} // Use ID for Command's internal value/search mechanism if needed
                    onSelect={() => handleSelect(signature)}
                    className="cursor-pointer">
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        selectedSignatureId === signature.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {signature.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup>
              <CommandItem
                className="cursor-pointer"
                onSelect={() => {
                  // Handle adding a new signature
                  // This could be a modal or redirect to a form
                  router.push('/app/settings/signatures/new') // Example: redirect to a new signature form
                }}>
                <Signature className="mr-2 h-4 w-4" />
                Add New Signature
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// --- Form Component ---

interface FormSignaturePickerProps<TFieldValues extends FieldValues = FieldValues>
  extends Omit<SignaturePickerProps, 'value' | 'onChange' | 'open' | 'onOpenChange'> {
  name: FieldPath<TFieldValues>
  label?: string
  description?: string
}

/**
 * Signature Picker component integrated with react-hook-form.
 * It expects to be used within a FormProvider context.
 * The field value will be the selected Signature object (or null).
 */
export function FormSignaturePicker<TFieldValues extends FieldValues = FieldValues>({
  name,
  label,
  description,
  ...pickerProps // Pass remaining SignaturePicker props
}: FormSignaturePickerProps<TFieldValues>) {
  const { control } = useFormContext<TFieldValues>() // Get control from context

  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem className="flex flex-col">
          {label && <FormLabel>{label}</FormLabel>}
          <SignaturePicker
            // Pass the field's value and onChange handler
            // The value stored in the form state will be the Signature object or null
            value={field.value as Signature | null} // Cast might be needed depending on form schema
            onChange={field.onChange} // RHF's onChange expects the value directly
            // Handle popover state within the FormField instance
            popoverOpen={field.value !== undefined && field.value !== null ? undefined : false} // Example: keep open state managed internally unless explicitly controlled elsewhere
            // Pass down other props
            {...pickerProps}
            // Default trigger using field state
            children={
              pickerProps.children ?? (
                <FormControl>
                  <Button
                    variant="outline"
                    role="combobox"
                    className={cn(
                      'w-full justify-between', // Adjust width as needed
                      !field.value && 'text-muted-foreground'
                    )}
                    // No need for onClick handler here, PopoverTrigger handles it
                  >
                    {(field.value as Signature | null)?.name ??
                      pickerProps.searchPlaceholder ??
                      'Select signature...'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </FormControl>
              )
            }
          />
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
