// apps/web/src/app/(protected)/app/settings/inbox/page.tsx
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'
import { InboxList } from '~/components/inbox'

export default function InboxesPage() {
  return (
    <>
      <CapabilityPageGuard permissionKey='channels.manage' />
      <InboxList />
    </>
  )
}
