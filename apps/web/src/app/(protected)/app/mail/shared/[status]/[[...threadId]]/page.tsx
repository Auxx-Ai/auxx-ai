// apps/web/src/app/(protected)/app/mail/shared/[status]/[[...threadId]]/page.tsx

import { Mailbox } from '../../../_components/mail-box'

interface PageProps {
  params: Promise<{ status: string; threadId?: string[] }>
}

/** Mailbox containing conversations explicitly shared with the current user. */
export default async function SharedWithMePage({ params }: PageProps) {
  const { status } = await params

  return (
    <Mailbox
      key={`shared-with-me-${status}`}
      contextType='shared_with_me'
      initialStatusSlug={status}
    />
  )
}
