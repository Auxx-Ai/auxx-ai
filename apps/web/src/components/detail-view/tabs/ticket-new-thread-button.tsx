// apps/web/src/components/detail-view/tabs/ticket-new-thread-button.tsx
'use client'

import type { ReactNode } from 'react'
import type { EditorPresetValues } from '~/components/mail/email-editor/types'
import { useCompose } from '~/hooks/use-compose'

interface NewThreadForTicketButtonProps {
  ticketId: string
  ticket?: Record<string, unknown>
  onCreated: () => void
  children: ReactNode
}

/**
 * Button that opens a floating compose editor to create a new thread linked to a ticket.
 * Pre-fills subject from ticket title and auto-links via linkTicketId preset.
 */
export function NewThreadForTicketButton({
  ticketId,
  ticket,
  children,
}: NewThreadForTicketButtonProps) {
  const { openCompose } = useCompose()

  const presetValues: EditorPresetValues = {
    subject: ticket?.title ? String(ticket.title) : '',
    linkTicketId: ticketId,
  }

  return <div onClick={() => openCompose({ presetValues })}>{children}</div>
}
