// apps/web/src/components/mail/email-editor/signature-editor.tsx
import { Pencil, Plus, X, Loader2 } from 'lucide-react'
import React, { useState, useEffect } from 'react'
import { SignaturePicker } from '~/components/pickers/signature-picker'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton' // For loading state
import { api } from '~/trpc/react'
import { useEditorActiveStateContext } from './editor-active-state-context'
import type { Signature } from '@auxx/database/types'
import { sanitizeHtml } from '~/lib/sanitize'
/**
 * Props for the SignatureEditor component.
 */
interface SignatureEditorProps {
  /** The ID of the integration context to fetch the default signature for. */
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
 * Fetches default and available signatures based on context.
 */
function SignatureEditor({
  integrationId,
  selectedSignatureId,
  onSignatureChange,
  disabled = false,
}: SignatureEditorProps) {
  // State to manage the currently displayed signature object
  const [currentSignature, setCurrentSignature] = useState<Signature | null>(null)
  // State to control visibility of the signature display vs. the "Add" button
  const [showSignature, setShowSignature] = useState(false)
  // Track popover state for editor active state
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const { trackPopoverOpen, trackPopoverClose } = useEditorActiveStateContext()
  // --- Data Fetching ---
  const { data: defaultSignatureData, isLoading: isLoadingDefault } =
    api.signature.getDefaultForContext.useQuery(
      { integrationId }, // Pass inboxId, even if service logic doesn't use it yet
      {
        staleTime: 5 * 60 * 1000, // Cache for 5 minutes
      }
    )
  const { data: allSignaturesData, isLoading: isLoadingAll } = api.signature.getAll.useQuery(
    undefined,
    {
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    }
  )
  // Available signatures for the picker (filter out potential nulls if API could return them)
  const availableSignatures = allSignaturesData?.filter(Boolean) ?? []
  // Fetch the specific signature if selectedSignatureId is provided
  const { data: selectedSignatureData, isLoading: isLoadingSelected } =
    api.signature.getById.useQuery(
      { id: selectedSignatureId! }, // Use non-null assertion, enabled dictates call
      {
        enabled: !!selectedSignatureId, // Only run query if selectedSignatureId has a value
        staleTime: Infinity, // Cache forever once fetched for a specific ID unless invalidated
      }
    )
  // Combined loading state
  const isLoading = isLoadingDefault || isLoadingAll || (!!selectedSignatureId && isLoadingSelected)
  // --- Effects ---
  // Effect to determine the initial signature to display based on props and fetched data
  useEffect(() => {
    let initialSignature: Signature | null = null
    if (selectedSignatureId && selectedSignatureData) {
      // Use the explicitly selected signature from props/draft
      initialSignature = selectedSignatureData
      setCurrentSignature(initialSignature)
      setShowSignature(true)
    } else if (selectedSignatureId === null) {
      // User explicitly removed signature or it's not set
      // Don't auto-apply default, let user choose
      setCurrentSignature(null)
      // Keep showSignature as is - don't hide if user is interacting
    }
    // If selectedSignatureId is set but data is still loading, wait for data
  }, [selectedSignatureId, selectedSignatureData])
  // Track popover open/close state
  useEffect(() => {
    if (isPickerOpen) {
      trackPopoverOpen('signature-picker')
    } else {
      trackPopoverClose('signature-picker')
    }
    return () => {
      // Cleanup on unmount
      trackPopoverClose('signature-picker')
    }
  }, [isPickerOpen, trackPopoverOpen, trackPopoverClose])
  // --- Handlers ---
  const handleAddClick = () => {
    if (disabled) return
    // When clicking "Add", show the signature area.
    // If a default exists, pre-fill with it and notify parent.
    // If no default, show empty area and let picker selection fill it.
    if (defaultSignatureData) {
      setCurrentSignature(defaultSignatureData)
      onSignatureChange(defaultSignatureData.id) // Notify parent that default is now active
    } else {
      setCurrentSignature(null) // Ensure no stale signature is shown
      onSignatureChange(null) // Ensure parent knows no signature is active
    }
    setShowSignature(true)
    // Note: The picker should ideally open automatically here if no default exists.
    // We rely on the user clicking the Pencil icon if they want to choose immediately.
  }
  const handleRemoveClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation() // Prevent click from propagating to parent divs
    setShowSignature(false)
    setCurrentSignature(null)
    onSignatureChange(null) // Notify parent that signature is removed
  }
  const handleSelectFromPicker = (signature: Signature) => {
    if (disabled) return
    setCurrentSignature(signature)
    setShowSignature(true)
    onSignatureChange(signature.id) // Notify parent of the new selection
    // Picker should close itself upon selection
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
              initialSignatures={availableSignatures}
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
