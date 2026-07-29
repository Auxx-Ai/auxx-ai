// apps/web/src/app/(protected)/app/settings/inbox/[inboxId]/page.tsx
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'
import { InboxDetail } from '~/components/inbox'

export default async function InboxDetailPage({
  params,
}: {
  params: Promise<{ inboxId: string }>
}) {
  const { inboxId } = await params

  return (
    <>
      <CapabilityPageGuard permissionKey='inboxes.view' />
      <InboxDetail inboxId={inboxId} />
    </>
  )
}
