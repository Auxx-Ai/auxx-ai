// apps/web/src/components/signatures/ui/signature-editor.tsx
'use client'

import { Pencil, Plus, X } from 'lucide-react'
import React, { useState, useEffect } from 'react'
import { SignaturePicker } from './signature-picker'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useEditorActiveStateContext } from '~/components/mail/email-editor/editor-active-state-context'
import { sanitizeHtml } from '~/lib/sanitize'
import { useSignatures, useSignature, useDefaultSignature, type SignatureItem } from '../hooks'

/**
 * Props for the SignatureEditor component.
 */
interface SignatureEditorProps {
  /** The ID of the integration context (for future use with integration-specific defaults) */
  integrationId: string
  /** The ID of the signature currently selected (e.g., from a draft), or null if none. */
  selectedSignatureId: string | null
  /** Callback function triggered when the signature selection changes. */
  onSignatureChange: (signatureId: string | null) => void
  /** Optional: Disable interactions. */
  disabled?: boolean
}

/**
 * Component for selecting and displaying an email signature within the editor.
 * Uses the entity system via useSignatures hook.
 */
function SignatureEditor({
  integrationId,
  selectedSignatureId,
  onSignatureChange,
  disabled = false,
}: SignatureEditorProps) {
  // State to manage the currently displayed signature object
  const [currentSignature, setCurrentSignature] = useState<SignatureItem | null>(null)
  // State to control visibility of the signature display vs. the "Add" button
  const [showSignature, setShowSignature] = useState(false)
  // Track popover state for editor active state
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const { trackPopoverOpen, trackPopoverClose } = useEditorActiveStateContext()

  // --- Data Fetching using hooks ---
  const { signatures, isLoading: isLoadingAll } = useSignatures()
  const { signature: defaultSignature, isLoading: isLoadingDefault } = useDefaultSignature()
  const { signature: selectedSignatureData, isLoading: isLoadingSelected } =
    useSignature(selectedSignatureId)

  // Combined loading state
  const isLoading = isLoadingDefault || isLoadingAll || (!!selectedSignatureId && isLoadingSelected)

  // --- Effects ---
  // Effect to determine the initial signature to display based on props and fetched data
  useEffect(() => {
    if (selectedSignatureId && selectedSignatureData) {
      // Use the explicitly selected signature from props/draft
      setCurrentSignature(selectedSignatureData)
      setShowSignature(true)
    } else if (selectedSignatureId === null) {
      // User explicitly removed signature or it's not set
      setCurrentSignature(null)
    }
  }, [selectedSignatureId, selectedSignatureData])

  // Track popover open/close state
  useEffect(() => {
    if (isPickerOpen) {
      trackPopoverOpen('signature-picker')
    } else {
      trackPopoverClose('signature-picker')
    }
    return () => {
      trackPopoverClose('signature-picker')
    }
  }, [isPickerOpen, trackPopoverOpen, trackPopoverClose])

  // --- Handlers ---
  const handleAddClick = () => {
    if (disabled) return
    // When clicking "Add", show the signature area.
    // If a default exists, pre-fill with it and notify parent.
    if (defaultSignature) {
      setCurrentSignature(defaultSignature)
      onSignatureChange(defaultSignature.id)
    } else {
      setCurrentSignature(null)
      onSignatureChange(null)
    }
    setShowSignature(true)
  }

  const handleRemoveClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    setShowSignature(false)
    setCurrentSignature(null)
    onSignatureChange(null)
  }

  const handleSelectFromPicker = (signature: SignatureItem | null) => {
    if (disabled || !signature) return
    setCurrentSignature(signature)
    setShowSignature(true)
    onSignatureChange(signature.id)
  }

  // --- Render Logic ---
  if (isLoading) {
    return (
      <div className="group relative m-2 mb-0 rounded-md p-2">
        <Skeleton className="h-8 w-3/4" />
      </div>
    )
  }

  return (
    <div
      className={`group mx-2 relative rounded-md ${showSignature ? 'hover:bg-muted dark:hover:bg-muted' : ''} ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      {showSignature ? (
        <div className="p-2">
          {/* Render signature body */}
          <div
            className="prose prose-sm max-w-none text-sm dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentSignature?.body ?? '--') }}
          />
          {/* Edit/Remove Controls */}
          <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <SignaturePicker
              initialSignatures={signatures}
              onChange={handleSelectFromPicker}
              disabled={disabled}
              popoverOpen={isPickerOpen}
              onPopoverOpenChange={setIsPickerOpen}>
              <button
                title="Change signature"
                className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/30 text-xs text-background hover:bg-foreground/50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}>
                <Pencil className="h-3 w-3" />
              </button>
            </SignaturePicker>
            <button
              title="Remove signature"
              className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/30 text-xs text-background hover:bg-foreground/50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleRemoveClick}
              disabled={disabled}>
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : (
        // "Add Signature" Button
        <div className="">
          <Button
            variant="ghost"
            size="xs"
            onClick={handleAddClick}
            loading={isLoadingDefault}
            loadingText="Loading..."
            disabled={disabled}
            aria-disabled={disabled}
            className="text-muted-foreground/50">
            <Plus className="size-4" />
            Add signature
          </Button>
        </div>
      )}
    </div>
  )
}

export default SignatureEditor
