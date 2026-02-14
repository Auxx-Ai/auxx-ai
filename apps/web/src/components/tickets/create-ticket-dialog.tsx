// ~/components/tickets/create-ticket-dialog.tsx
'use client'
import { Button } from '@auxx/ui/components/button'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import TicketFormDialog from '~/app/(protected)/app/tickets/_components/ticket-form-dialog'

interface CreateTicketDialogProps {
  contactId: string
  onSuccess?: () => void
}

/**
 * CreateTicketDialog component
 * Renders a button that opens a dialog for creating a new support ticket for a contact
 */
export default function CreateTicketDialog({
  contactId,
  onSuccess,
  children,
}: CreateTicketDialogProps & { children?: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {children ? (
        <span onClick={() => setIsOpen(true)}>{children}</span>
      ) : (
        <Button variant='info' size='sm' className='px-2' onClick={() => setIsOpen(true)}>
          <PlusIcon className='h-4 w-4' />
          New Ticket
        </Button>
      )}
      <TicketFormDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        contactId={contactId}
        onSuccess={() => {
          setIsOpen(false)
          onSuccess?.()
        }}
      />
    </>
  )
}
