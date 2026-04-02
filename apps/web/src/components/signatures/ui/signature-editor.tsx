// apps/web/src/components/signatures/ui/signature-editor.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Feather, Pencil, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useEditorActiveStateContext } from '~/components/mail/email-editor/editor-active-state-context'
import { sanitizeHtml } from '~/lib/sanitize'
import { useDefaultSignature, useSignatures } from '../hooks'
import { SignaturePicker } from './signature-picker'

/** Props for the SignatureEditor component */
interface SignatureEditorProps {
  integrationId: string
  selectedSignatureId: string | null
  onSignatureChange: (signatureId: string | null) => void
  disabled?: boolean
  /** className forwarded to the signature picker's PopoverContent (e.g. for z-index override) */
  className?: string
}

/**
 * Component for selecting and displaying an email signature within the editor.
 */
function SignatureEditor({
  selectedSignatureId,
  onSignatureChange,
  disabled = false,
  className,
}: SignatureEditorProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const { trackPopoverOpen, trackPopoverClose } = useEditorActiveStateContext()

  // Data fetching
  const { signatures, signatureMap, isLoading: isLoadingSignatures } = useSignatures()
  const { signature: defaultSignature, isLoading: isLoadingDefault } = useDefaultSignature()

  const isLoading = isLoadingSignatures || isLoadingDefault

  // Get current signature from map (derived state, no useState needed)
  const currentSignature = selectedSignatureId ? signatureMap.get(selectedSignatureId) : null

  // Track popover state for editor active context
  useEffect(() => {
    if (isPickerOpen) {
      trackPopoverOpen('signature-picker')
    } else {
      trackPopoverClose('signature-picker')
    }
    return () => trackPopoverClose('signature-picker')
  }, [isPickerOpen, trackPopoverOpen, trackPopoverClose])

  // Add signature (use default if available, otherwise open picker)
  const handleAddClick = useCallback(() => {
    if (disabled) return
    if (defaultSignature) {
      onSignatureChange(defaultSignature.id)
    } else {
      setIsPickerOpen(true)
    }
  }, [disabled, defaultSignature, onSignatureChange])

  // Remove signature
  const handleRemoveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onSignatureChange(null)
    },
    [onSignatureChange]
  )

  // Select from picker
  const handleSelect = useCallback(
    (signatureId: string | null) => {
      if (!disabled) onSignatureChange(signatureId)
    },
    [disabled, onSignatureChange]
  )

  if (isLoading) {
    return (
      <div className='group relative mx-2 mb-0 rounded-md'>
        <Skeleton className='h-4 w-26' />
      </div>
    )
  }

  // No signature selected - show "Add" button with picker
  if (!currentSignature) {
    return (
      <div className='mx-2'>
        <SignaturePicker
          signatures={signatures}
          selected={null}
          onChange={handleSelect}
          open={isPickerOpen}
          onOpenChange={setIsPickerOpen}
          disabled={disabled}
          align='start'
          className={className}>
          <Button
            variant='ghost'
            size='xs'
            onClick={handleAddClick}
            disabled={disabled}
            className='text-muted-foreground/50'>
            <Feather className='size-3.5' />
            Add signature
          </Button>
        </SignaturePicker>
      </div>
    )
  }

  // Signature selected - show body with edit/remove controls
  return (
    <div
      className={`group mx-2 relative rounded-md hover:bg-muted dark:hover:bg-muted ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <div className='p-2'>
        <div
          className='prose prose-sm max-w-none text-sm dark:prose-invert'
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentSignature.body) }}
        />
        {/* Edit/Remove Controls */}
        <div className='absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
          <SignaturePicker
            signatures={signatures}
            selected={selectedSignatureId}
            onChange={handleSelect}
            open={isPickerOpen}
            onOpenChange={setIsPickerOpen}
            disabled={disabled}
            align='end'
            className={className}>
            <button
              title='Change signature'
              className='flex size-5 items-center justify-center rounded-full bg-foreground/30 text-xs text-background hover:bg-foreground/50 disabled:cursor-not-allowed disabled:opacity-50'
              disabled={disabled}>
              <Pencil className='size-3' />
            </button>
          </SignaturePicker>
          <button
            title='Remove signature'
            className='flex size-5 items-center justify-center rounded-full bg-foreground/30 text-xs text-background hover:bg-foreground/50 disabled:cursor-not-allowed disabled:opacity-50'
            onClick={handleRemoveClick}
            disabled={disabled}>
            <X className='size-3' />
          </button>
        </div>
      </div>
    </div>
  )
}

export default SignatureEditor
