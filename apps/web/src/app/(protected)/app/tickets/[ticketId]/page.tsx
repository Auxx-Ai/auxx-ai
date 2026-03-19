// apps/web/src/app/(protected)/app/tickets/[ticketId]/page.tsx

import { DetailView } from '~/components/detail-view'

type Props = { params: Promise<{ ticketId: string }> }

/**
 * Ticket detail page using the universal DetailView component
 */
async function TicketDetailPage({ params }: Props) {
  const { ticketId } = await params

  return <DetailView apiSlug='ticket' instanceId={ticketId} />
}

export default TicketDetailPage
