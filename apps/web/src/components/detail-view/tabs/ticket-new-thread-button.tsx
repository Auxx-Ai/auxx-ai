// apps/web/src/components/detail-view/tabs/ticket-new-thread-button.tsx
'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { NewMessageDialog } from '~/components/mail/email-editor/new-message-dialog'
import type { EditorPresetValues } from '~/components/mail/email-editor/types'

interface NewThreadForTicketButtonProps {
  ticketId: string
  ticket?: Record<string, unknown>
  onCreated: () => void
  children: ReactNode
}

/**
 * Button that opens a compose dialog to create a new thread linked to a ticket.
 * Pre-fills subject from ticket title and auto-links via linkTicketId preset.
 */
export function NewThreadForTicketButton({
  ticketId,
  ticket,
  onCreated,
  children,
}: NewThreadForTicketButtonProps) {
  const [open, setOpen] = useState(false)

  // Build preset values from ticket data
  const presetValues: EditorPresetValues = {
    subject: ticket?.title ? String(ticket.title) : '',
    linkTicketId: ticketId,
  }

  const handleSendSuccess = () => {
    onCreated()
  }

  return (
    <>
      <div onClick={() => setOpen(true)}>{children}</div>
      <NewMessageDialog
        open={open}
        onOpenChange={setOpen}
        onSendSuccess={handleSendSuccess}
        presetValues={presetValues}
      />
    </>
  )
}
