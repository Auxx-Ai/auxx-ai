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

/** Shared props for the signature trigger button and the signature panel. */
interface SignatureProps {
  integrationId: string
  selectedSignatureId: string | null
  onSignatureChange: (signatureId: string | null) => void
  disabled?: boolean
  /** className forwarded to the signature picker's PopoverContent (e.g. for z-index override) */
  className?: string
}

/**
 * Track the signature picker popover in the editor active-state context, so the
 * editor doesn't treat itself as blurred while the picker is open.
 */
function usePickerActiveTracking(isPickerOpen: boolean) {
  const { trackPopoverOpen, trackPopoverClose } = useEditorActiveStateContext()
  useEffect(() => {
    if (isPickerOpen) {
      trackPopoverOpen('signature-picker')
    } else {
      trackPopoverClose('signature-picker')
    }
    return () => trackPopoverClose('signature-picker')
  }, [isPickerOpen, trackPopoverOpen, trackPopoverClose])
}

/**
 * The "Add signature" trigger button (with picker). Renders `null` once a
 * signature is selected — the body then lives in {@link SignaturePanel}.
 */
export function SignatureAddButton({
  selectedSignatureId,
  onSignatureChange,
  disabled = false,
  className,
}: SignatureProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  usePickerActiveTracking(isPickerOpen)

  const { signatures, signatureMap, isLoading: isLoadingSignatures } = useSignatures()
  const { signature: defaultSignature, isLoading: isLoadingDefault } = useDefaultSignature()
  const isLoading = isLoadingSignatures || isLoadingDefault

  const currentSignature = selectedSignatureId ? signatureMap.get(selectedSignatureId) : null

  // Add signature (use default if available, otherwise open picker)
  const handleAddClick = useCallback(() => {
    if (disabled) return
    if (defaultSignature) {
      onSignatureChange(defaultSignature.id)
    } else {
      setIsPickerOpen(true)
    }
  }, [disabled, defaultSignature, onSignatureChange])

  const handleSelect = useCallback(
    (signatureId: string | null) => {
      if (!disabled) onSignatureChange(signatureId)
    },
    [disabled, onSignatureChange]
  )

  if (isLoading) {
    return <Skeleton className='h-6 w-26' />
  }

  // A signature is selected — the body renders in SignaturePanel, not here.
  if (currentSignature) return null

  return (
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
        className='h-6 gap-1 text-muted-foreground/50'>
        <Feather className='size-3.5' />
        Add signature
      </Button>
    </SignaturePicker>
  )
}

/**
 * The selected-signature body with hover edit/remove controls. Renders `null`
 * when no signature is selected — the trigger lives in {@link SignatureAddButton}.
 */
export function SignaturePanel({
  selectedSignatureId,
  onSignatureChange,
  disabled = false,
  className,
}: SignatureProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  usePickerActiveTracking(isPickerOpen)

  const { signatures, signatureMap, isLoading } = useSignatures()
  const currentSignature = selectedSignatureId ? signatureMap.get(selectedSignatureId) : null

  const handleRemoveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onSignatureChange(null)
    },
    [onSignatureChange]
  )

  const handleSelect = useCallback(
    (signatureId: string | null) => {
      if (!disabled) onSignatureChange(signatureId)
    },
    [disabled, onSignatureChange]
  )

  // Skeleton is owned by SignatureAddButton; nothing to show here until selected.
  if (isLoading || !currentSignature) return null

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
