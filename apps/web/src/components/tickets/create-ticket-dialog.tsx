'use client'
// ~/components/customers/create-ticket-dialog.tsx
import { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { PlusIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import TicketForm from '../../app/(protected)/app/tickets/_components/ticket-form'

interface CreateTicketDialogProps {
  contactId: string
  onSuccess?: () => void
}

/**
 * CreateTicketDialog component
 * Renders a dialog for creating a new support ticket for a contact
 */
export default function CreateTicketDialog({
  contactId,
  onSuccess,
  children,
}: CreateTicketDialogProps & { children?: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children ? (
          children
        ) : (
          <Button variant="info" size="sm" className="px-2">
            <PlusIcon className="h-4 w-4" />
            New Ticket
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-screen max-w-3xl overflow-y-scroll">
        <DialogHeader className="mb-4">
          <DialogTitle>Create New Support Ticket</DialogTitle>
          <DialogDescription>
            Fill out the form below to create a new support ticket.
          </DialogDescription>
        </DialogHeader>
        <TicketForm
          contactId={contactId}
          onSuccess={() => {
            setIsOpen(false)
            onSuccess?.()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
