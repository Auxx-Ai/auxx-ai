import { redirect } from 'next/navigation'

type Props = {}

function TicketSettings({}: Props) {
  redirect('/app/tickets/settings/format')
}

export default TicketSettings
