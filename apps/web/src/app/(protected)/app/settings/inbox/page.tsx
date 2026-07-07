// apps/web/src/app/(protected)/app/settings/inbox/page.tsx
import { AdminPageGuard } from '~/components/global/admin-page-guard'
import { InboxList } from '~/components/inbox'

export default function InboxesPage() {
  return (
    <>
      <AdminPageGuard />
      <InboxList />
    </>
  )
}
