// apps/web/src/app/(protected)/app/settings/inbox/[inboxId]/page.tsx
import { InboxDetail } from '~/components/inbox'

export default async function InboxDetailPage({
  params,
}: {
  params: Promise<{ inboxId: string }>
}) {
  const { inboxId } = await params

  return <InboxDetail inboxId={inboxId} />
}
