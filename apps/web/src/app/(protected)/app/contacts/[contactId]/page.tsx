import React from 'react'
import { ContactDetail } from '../_components/contact-detail'

type Props = { params: Promise<{ contactId: string }> }

async function ContactDetailPage({ params }: Props) {
  const { contactId } = await params

  return <ContactDetail id={contactId} />
}

export default ContactDetailPage
