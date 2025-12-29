import { redirect } from 'next/navigation'
import React from 'react'

type Props = {}

function TicketSettings({}: Props) {
  redirect('/app/tickets/settings/format')
}

export default TicketSettings
