'use client'
import { Dialog, DialogContent, DialogTitle } from '@auxx/ui/components/dialog'
import { useRouter } from 'next/navigation'
// import { VendorForm } from '../../_components/vendor-form'
import { VisuallyHidden } from '@auxx/ui/components/visually-hidden'
// import { PartForm } from '../../_components/part-form'
import React from 'react'
import TicketForm from '../../_components/ticket-form'

const TicketCreatePage = () => {
  const router = useRouter()
  const [isOpen, setIsOpen] = React.useState(true)
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <VisuallyHidden>
        <DialogTitle>Create New Ticket</DialogTitle>
      </VisuallyHidden>
      <DialogContent className="max-h-screen max-w-3xl overflow-y-scroll">
        <TicketForm
          onClose={(ticket) => {
            setIsOpen(false)

            if (ticket) {
              router.push(`/app/tickets/${ticket.id}`)
            }
          }}
        />
        {/* <PartForm
          onClose={(partId) => {
            setIsOpen(false)
            if (partId) {
              router.push(`/app/parts/${partId}`)
              // router.refresh()
            }
          }}
        /> */}
      </DialogContent>
    </Dialog>
  )
}

export default TicketCreatePage
