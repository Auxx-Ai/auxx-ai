// /app/settings/inbox/[inboxId]/page.tsx
import { InboxDetail } from '../_components/inbox-detail'

export default async function InboxDetailPage({
  params,
}: {
  params: Promise<{ inboxId: string }>
}) {
  const { inboxId } = await params

  return (
    // <div className='container mx-auto py-6'>
    <InboxDetail inboxId={inboxId} />
    // </div>
  )
}
