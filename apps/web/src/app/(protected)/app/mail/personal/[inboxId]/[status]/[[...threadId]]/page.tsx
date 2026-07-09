// apps/web/src/app/(protected)/app/mail/personal/[inboxId]/[status]/[[...threadId]]/page.tsx

import { Mailbox } from '../../../../_components/mail-box'

type Props = {
  params: Promise<{ inboxId: string; status: string; threadId?: string[] }>
}

/**
 * Personal-channel inbox view (mail-permissions §11): the owner's connected
 * mailbox with personal tabs (Open/Done/Trash/Spam). Visibility-scope
 * guarantees only the owner sees these threads.
 */
export default async function PersonalInboxStatusPage({ params }: Props) {
  const { inboxId, status } = await params

  return (
    <Mailbox
      key={`personal-${inboxId}-${status}`}
      contextType='personal_channel'
      contextId={inboxId}
      initialStatusSlug={status}
    />
  )
}
