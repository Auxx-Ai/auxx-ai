import React from 'react'
import TicketDetail from '../_components/ticket-detail'
// import TicketDetail from '../_components/ticket-detail'

type Props = { params: Promise<{ ticketId: string }> }

async function TicketDetailPage({ params }: Props) {
  const { ticketId } = await params

  return (
    <div>
      <TicketDetail ticketId={ticketId} />
    </div>
  )
}

export default TicketDetailPage
