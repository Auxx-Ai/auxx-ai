// apps/web/src/app/(protected)/app/contacts/[contactId]/page.tsx

import { DetailView } from '~/components/detail-view'
import { ContactViewTracker } from './_components/contact-view-tracker'

type Props = { params: Promise<{ contactId: string }> }

/**
 * Contact detail page using the universal DetailView component
 */
async function ContactDetailPage({ params }: Props) {
  const { contactId } = await params

  return (
    <>
      <ContactViewTracker contactId={contactId} />
      <DetailView apiSlug='contact' instanceId={contactId} />
    </>
  )
}

export default ContactDetailPage
