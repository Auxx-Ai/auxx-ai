// src/components/mail/email-editor/prev-message.tsx
import { Ellipsis, X } from 'lucide-react'
import React from 'react'
import { Letter } from 'react-letter'
import { Button } from '@auxx/ui/components/button'
import type { RouterOutputs } from '~/trpc/react'

// Reuse types from the editor
type ThreadWithDetails = RouterOutputs['thread']['getById']
type MessageType = ThreadWithDetails['messages'][number]
type DraftMessageType = Exclude<ThreadWithDetails['draftMessage'], null>

interface PrevMessageProps {
  message: MessageType | DraftMessageType // Pass the full message object
  onRemove: () => void // Callback when user clicks remove
  initialVisible?: boolean // Optional: control initial state
}

function PrevMessage({
  message,
  onRemove,
  initialVisible = false, // Default to visible
}: PrevMessageProps) {
  const [isVisible, setIsVisible] = React.useState(initialVisible)

  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent toggling visibility if clicking remove
    onRemove() // Call the parent's remove handler
  }

  // Extract details for display (add fallback for drafts/missing data)
  const sender = message.from?.displayName ?? message.from?.identifier ?? 'Unknown Sender'
  const sentDate = message.sentAt ? new Date(message.sentAt).toLocaleString() : 'Draft'
  const bodyHtml = message.textHtml ?? `<p>${message.textPlain?.replace(/\n/g, '<br>') ?? ''}</p>`

  // Basic sanitization (consider a library like DOMPurify for production)
  const sanitizedBodyHtml = bodyHtml.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    ''
  )

  if (!isVisible) {
    // Only show the Ellipsis button if collapsed
    return (
      <div className="mx-2 mb-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsVisible(true)}
          className="h-5 w-7"
          title="Show quoted message">
          <Ellipsis className="size-3" />
        </Button>
      </div>
    )
  }

  // Render the full component if visible
  return (
    <div className="group relative mx-2 mb-2 rounded-md pb-1 pt-1 hover:bg-muted">
      {/* Header with Toggle and Remove */}
      <div className="flex items-center justify-between px-2 pb-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsVisible(false)} // Click Ellipsis to hide
          className="h-5 w-7"
          title="Hide quoted message">
          <Ellipsis className="size-3" />
        </Button>
        {/* Show remove button on hover */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            title="Remove quoted message from reply"
            className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/30 text-xs text-background hover:bg-foreground/50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleRemoveClick}>
            <X className="size-3" />
          </button>
        </div>
      </div>

      {/* Message Content */}
      <div className="mb-1 ms-3 border-l-2 border-l-primary/20 px-2 pb-1">
        <div className="pb-1 text-xs text-muted-foreground">
          On {sentDate}, {sender} wrote:
        </div>
        <Letter className="text-sm" html={sanitizedBodyHtml} />
      </div>
    </div>
  )
}

export default PrevMessage
