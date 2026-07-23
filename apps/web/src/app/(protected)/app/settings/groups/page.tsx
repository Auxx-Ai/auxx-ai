// apps/web/src/app/(protected)/app/settings/groups/page.tsx
import { redirect } from 'next/navigation'

/** Groups moved into the unified Members page under the Groups tab. */
export default function GroupsPage() {
  redirect('/app/settings/members?t=groups')
}
