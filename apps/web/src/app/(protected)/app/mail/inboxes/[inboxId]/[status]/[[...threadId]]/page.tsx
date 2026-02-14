import { Mailbox } from '../../../../_components/mail-box'

type Props = {
  params: Promise<{ threadId: string; inboxId: string; status: string }>
  // searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

type ContextType = 'all_inboxes' | 'specific_inbox'

export default async function SpecificInboxStatusPage({ params }: Props) {
  const { inboxId, status } = await params

  const contextType: ContextType = inboxId == 'all' ? 'all_inboxes' : 'specific_inbox'

  // const contextType: ContextType = 'all_inboxes'

  return (
    <Mailbox
      key={`inbox-${inboxId}-${status}`}
      contextType={contextType}
      contextId={inboxId} // Pass inboxId as contextId
      initialStatusSlug={status}
    />
  )
}

// export default Inbox
